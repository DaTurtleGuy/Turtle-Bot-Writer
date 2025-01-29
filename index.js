import TelegramBot from "node-telegram-bot-api";
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import sharp from "sharp";


import { loadJsonFromFile, dumpJsonToFile } from "./src/JSONmanager.js";
import { loadTextFile, extractChosenImage, copyFile, getFileAsBase64, delay } from "./src/utils.js";
import { getNewPage, generateImages, loginWithToken, claimDailyReward, isLoggedIn, logOut, pixaiSite, closeBrowser, getBestToken, storeCredits } from "./src/pixaiHandler.js";

import { write, read, parse } from "./src/character-card-parser.js";

import fs from 'fs';
import path, { format } from "path";
import { dirname } from "path";
import { fileURLToPath } from 'url';
import https from 'https';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { Lock } from "./src/lock.js";
import { claimQuotas, getValidTokens } from "./autoclaim.js";
import { generatePixaiImage, getPixaiImageUrls } from "./newPixai.js";
import { downloadImage } from "./src/imageDownloader.js";
import { error } from "console";

dotenv.config();

const token = process.env.TOKEN;
let pixaiHashes = process.env.PIXAIHASHES;
const API_KEY = process.env.API_KEY;
const tokenLimit = parseInt(process.env.TOKEN_LIMIT);
const GeminiModel = process.env.GEMINI_MODEL;


let userChatID = process.env.USER_CHAT_ID;

let persistentPage = null;

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(API_KEY);

const safetySettings = [
    //Harassment
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE
    },
    //Sexually Explicit
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE
    },
    //Hate Speech
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE
    },
    //Dangerous
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE
    }
]
const model = genAI.getGenerativeModel({ model: 'models/gemini-2.0-flash-exp', safetySettings: safetySettings });

function getArgument(str) {
    const firstSpaceIndex = str.indexOf(' '); // Find the first space
    if (firstSpaceIndex !== -1) {
        return str.slice(firstSpaceIndex + 1).split(" "); // Return everything after the first space
    }
    return []; // If no space is found (only the command), return an empty string
}

function removePrefix(str) {
    return str.replace(/^\w+:\s*/, '');
}

async function formatStringForModel(chat, max_tokens) {
    async function convertToFormat(inputString) {
        const parts = inputString.split(/\[\[|\]\]/); // Use normal brackets
        const requests = [];

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();

            if (part.startsWith("type:")) {
                const [typePart, data] = part.split(",");
                const mimeType = typePart.split(":")[1].trim();
                const base64Data = data.trim();

                requests.push({
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType,
                    },
                });
            } else if (part !== "") {
                requests.push(part);
            }
        }
        return requests;
    }

    let formattedPrompt = await convertToFormat(chat);
    formattedPrompt = await adjustChatToTokenLimit(formattedPrompt, max_tokens);

    return formattedPrompt;
}

async function adjustChatToTokenLimit(chat, max_tokens) {
    let formattedChat = chat;
    while ((await model.countTokens(formattedChat)).totalTokens > max_tokens) {
        formattedChat.pop();
    }
    return formattedChat;
}

async function generateContentFromFormatterList(inputList) {
    const result = await model.generateContent(inputList);
    return result.response.text();
}

async function generateContentFromFormattedString(inputString) {
    const parts = inputString.split(/\[\[|\]\]/); // Use normal brackets
    const requests = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();

        if (part.startsWith("type:")) {
            const [typePart, data] = part.split(",");
            const mimeType = typePart.split(":")[1].trim();
            const base64Data = data.trim();

            requests.push({
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType,
                },
            });
        } else if (part !== "") {
            requests.push(part);
        }
    }

    const result = await model.generateContent(requests);
    return result.response.text();
}

async function ensureVariables() {
    if (!token) {
        throw new Error("TELEGRAM_BOT_TOKEN is required");
    }
    if (!API_KEY) {
        throw new Error("API_KEY is required");
    }
    if (!pixaiHashes) {
        throw new Error("PIXAI_HASHES is required");
    }
    if (!tokenLimit) {
        throw new Error("TOKEN_LIMIT is required");
    }
    if (!GeminiModel) {
        throw new Error("GEMINI_MODEL is required");
    }
    if (!userChatID) {
        throw new Error("USER_CHAT_ID is required");
    }
    let validHashes = [];
    for (const hash of pixaiHashes.split(",")) {
        if (!hash) {
            throw new Error("PIXAI_HASHES contains an empty value");
        }
        if (hash.length > 16) {
            validHashes.push(hash.replace('"', ""));
            continue;
        }
        console.warn(`Invalid hash: ${hash}`);
    }
    pixaiHashes = validHashes;
}

async function sendMessageInChunks(chatID, response, parseMode = '') {
    const maxLength = 2000;
    let lines = response.split('\n');  // Split text into lines
    let currentMessage = '';

    for (let i = 0; i < lines.length; i++) {
        // If adding the line would exceed the max length, send the current message and reset
        if ((currentMessage + lines[i]).length > maxLength) {
            // Send the current message and reset it for the next one
            await bot.sendMessage(chatID, currentMessage, { parse_mode: parseMode });
            currentMessage = lines[i] + '\n';  // Start a new message with the current line
        } else {
            currentMessage += lines[i] + '\n';  // Add the current line to the current message
        }
    }

    // Send any remaining message after the loop
    if (currentMessage.length > 0) {
        // Ensure the last message doesn't exceed the max length by splitting if necessary
        if (currentMessage.length > maxLength) {
            let messageParts = [];
            while (currentMessage.length > maxLength) {
                let splitIndex = currentMessage.lastIndexOf(' ', maxLength);  // Find the last space within the limit
                messageParts.push(currentMessage.slice(0, splitIndex));
                currentMessage = currentMessage.slice(splitIndex).trim();  // Remaining part of the message
            }
            // Send all parts
            for (let part of messageParts) {
                await bot.sendMessage(chatID, part, { parse_mode: parseMode });
            }
        } else {
            await bot.sendMessage(chatID, currentMessage, { parse_mode: parseMode });
        }
    }
}


async function startup() {
    persistentPage = await getNewPage(pixaiHashes[0]);
    const loggedIn = await loginWithToken(persistentPage, pixaiHashes[0]);
    if (!loggedIn) {
        throw new Error("Failed to login to PixAI");
    }
    await delay(1000);
    console.log(await claimDailyReward(persistentPage));
    await delay(1000);
    await persistentPage.goto(pixaiSite);
}

async function claimDaylyForToken(token) {
    if (Array.isArray(token)) {
        const results = {};
        // Reuse one browser/page
        const page = await getNewPage(token[0]);
        for (const t of token) {
            let claimed = false;
            try {
                const loggedIn = await loginWithToken(page, t);
                if (!loggedIn) {
                    results[t] = false;
                    continue;
                }
                await delay(1000);
                const claimResult = await claimDailyReward(page);
                claimed = claimResult.includes("successfully") && !claimResult.includes("already");
                await logout(page);
                await delay(1000);
            } catch {
                claimed = false;
            }
            results[t] = claimed;
        }
        await closeBrowser(token[0]);
        return results;
    } else {
        const page = await getNewPage(token);
        let claimed = false;
        try {
            const loggedIn = await loginWithToken(page, token);
            if (!loggedIn) {
                await closeBrowser(token);
                return { [token]: false };
            }
            await delay(1000);
            const claimResult = await claimDailyReward(page);
            claimed = claimResult.includes("successfully") && !claimResult.includes("already");
            await logout(page);
            await delay(1000);
        } catch {
            claimed = false;
        }
        await closeBrowser(token);
        return { [token]: claimed };
    }
}

async function characterToImagePrompt(CharacterPrompt) {
    const apperancePrompt = await loadTextFile("prompts\\characterToPrompt.txt");

    const generatedApperance = await generateContentFromFormattedString(apperancePrompt + "\n\nHere's the character:\n\n```" + CharacterPrompt + "```");

    return generatedApperance;
}

async function promptToCharacter(prompt) {
    const generationPrompt = await loadTextFile("prompts\\writerPrompt.txt");

    const generatedCharacter = await generateContentFromFormattedString(generationPrompt + "\n\nHere's the prompt sent by the user:\n\n```" + prompt + "```");

    return generatedCharacter;
}

async function getKeyfromText(string, key) {
    const searchPrompt = await loadTextFile("prompts\\getArgumentFromString.txt");

    const response = await generateContentFromFormattedString(searchPrompt + "\n\n" + `String:${string}` + "\n\n" + `Key:${key}`);

    return extractStringValue(response);
}

function extractStringValue(text) {
    const match = text.match(/"([^"]*)"/);
    if (match) {
        return match[1];
    } else {
        return null;
    }
}


async function compareImages(images, prompt) {
    let comparisonPrompt = await loadTextFile("prompts\\choseImage.txt");
    comparisonPrompt += `\n\nPrompt: \`\`\`${prompt}\`\`\``;

    let base64Images = [];
    for (const image of images) {
        base64Images.push(await getFileAsBase64(image, true));
    }

    for (let i = 0; i < base64Images.length; i++) {
        comparisonPrompt += `\nImage N${i + 1}[[type:image/png, ${base64Images[i]}]]`;
    }

    const comparison = await generateContentFromFormattedString(comparisonPrompt);
    const CHOSEN_IMAGE = extractChosenImage(comparison);

    return CHOSEN_IMAGE ? images[CHOSEN_IMAGE - 1] : images[0];
}

async function GenerateCharacter(prompt, chatID = 0, messageID = 0, greetings_amount = 0) {

    const tokens = await loadJsonFromFile("tokens.json");
    if (!tokens) {
        if (chatID && messageID) bot.editMessageText("No tokens found. Please provide tokens using /tokens.", { chat_id: chatID, message_id: messageID });
        return;
    }
    let credits = await storeCredits(tokens);
    const bestToken = await getBestToken(credits);
    if (!bestToken) {
        if (chatID && messageID) bot.editMessageText("No valid tokens found. Please provide valid tokens using /tokens.", { chat_id: chatID, message_id: messageID });
        return;
    }

    if (chatID && messageID) bot.editMessageText("Generating Character card...", { chat_id: chatID, message_id: messageID });
    const characterPrompt = (await promptToCharacter(prompt)).replaceAll("`", "").trim();
    if (chatID && messageID) bot.editMessageText("Generating image generation prompt...", { chat_id: chatID, message_id: messageID });
    const characterImage = (await characterToImagePrompt(characterPrompt)).replaceAll("`", "");



    let images = [];
    try {
        while (true) {
            if (chatID && messageID) bot.editMessageText("Generating images...", { chat_id: chatID, message_id: messageID });
            const GenerationID = await generatePixaiImage(bestToken, "Expressiveh\nOne Person\n" + characterImage, "1811528826405408057", { "1748998561833317556": 0.7 });

            while (true) {
                try {
                    images = await getPixaiImageUrls(bestToken, GenerationID);
                    if (images.length > 0) {
                        break;
                    }
                }
                catch {
                    await delay(1000);
                }
            }
            if (images.length > 0) {
                break;
            }
            if (chatID && messageID) bot.editMessageText("No images were generated after timeout. Retrying...", { chat_id: chatID, message_id: messageID });
        }
        let newImages = [];
        for (let image of images) {
            newImages.push(await downloadImage(image));
        }
        images = newImages;
    }
    finally {
        console.log("Done with images");
    }

    if (chatID && messageID) bot.editMessageText("Comparing images...", { chat_id: chatID, message_id: messageID });
    const chosenImage = await compareImages(images, prompt);

    if (chatID && messageID) bot.editMessageText("Creating character card...", { chat_id: chatID, message_id: messageID });
    const characterName = await getKeyfromText(characterPrompt, "Nickname or name if not available");

    const filePath = await copyFile(chosenImage, "characters", characterName + ".png");

    const characterJson = {
        data: {
            name: characterName,
            description: characterPrompt,
            personality: "",
            scenario: "",
            first_mes: "",
            mes_example: "",
            creator_notes: "",
            system_prompt: "",
            post_history_instructions: "",
            tags: [],
            creator: "TurtleBotWriter",
            character_version: "",
            alternate_greetings: [],
            extensions: {
                talkativeness: "0.5",
                fav: false,
                world: "",
                depth_prompt: {
                    prompt: "",
                    depth: 4,
                    role: "system"
                }
            },
            group_only_greetings: []
        },
        name: characterName,
        description: characterPrompt,
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: "",
        creatorcomment: "",
        avatar: "none",
        talkativeness: "0.5",
        fav: false,
        tags: [],
        spec: "chara_card_v3",
        spec_version: "3.0",
    };


    let dumpFile = `characters\\${characterName}.json`;
    let i = 0;
    while (fs.existsSync(dumpFile)) {
        dumpFile = `characters\\${characterName}_${i}.json`;
        i++;
    }
    dumpJsonToFile(characterJson, dumpFile, null);

    const image = fs.readFileSync(filePath);

    const normalizedImage = await sharp(image).png().toBuffer();

    const updatedImage = write(normalizedImage, JSON.stringify(characterJson));

    fs.writeFileSync(filePath, updatedImage);
    if (chatID && messageID) bot.editMessageText("Done! Sending shortly", { chat_id: chatID, message_id: messageID });
    return {
        source: filePath,
        filename: `${characterName}.png`,
        description: characterPrompt,
        name: characterName
    };
}


function formatMessages(messages) {
    let prompt = "";
    for (const message of messages) {
        prompt += `${message.name === "Bot" || message.name === "System" ? message.name : "User"}: ${message.text}\n\n`;
    }
    return prompt;
}

// function formatMessages(messages) {
//     const output = [];
//     for (const message of messages) {
//         output.push({
//             role: message.name.toLowerCase() === "Bot".toLowerCase() || message.name.toLowerCase() === "System".toLowerCase() ? message.name.toLowerCase() : "user",
//             parts: [{ text: message.text }]
//         })
//     }

// }


const downloadFolder = path.join(__dirname, 'TelegramDowloads');
if (!fs.existsSync(downloadFolder)) {
    fs.mkdirSync(downloadFolder);
}

async function downloadFile(fileId) {
    try {
        // Get the file path using the fileId
        const file = await bot.getFile(fileId);
        const filePath = file.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

        // Determine the file name and ensure it doesn't overwrite
        const fileName = filePath.split('/').pop();
        let fileAbsPath = path.join(downloadFolder, fileName);

        // Add an index if the file already exists
        let index = 1;
        while (fs.existsSync(fileAbsPath)) {
            const extname = path.extname(fileName);
            const basename = path.basename(fileName, extname);
            fileAbsPath = path.join(downloadFolder, `${basename}_${index}${extname}`);
            index++;
        }

        // Download the file using a Promise
        await new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(fileAbsPath);
            https.get(fileUrl, (response) => {
                response.pipe(fileStream);
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
            }).on('error', reject);
        });

        return fileAbsPath;
    } catch (error) {
        console.error('Error downloading the file:', error);
        throw error;
    }
}

async function claimAll() {
    const messageID = (await bot.sendMessage(userChatID, "Claiming daily rewards...")).message_id;
    const tokens = await loadJsonFromFile("tokens.json");

    if (!tokens) {
        bot.editMessageText("No tokens found. Please provide tokens using /tokens.", { chat_id: userChatID, message_id: messageID });
        return;
    }
    const result = await claimQuotas(tokens);
    await bot.editMessageText(result, { chat_id: userChatID, message_id: messageID });
    return;
}






(async () => {
    try {
        await ensureVariables();
    } catch (error) {
        console.error(error);
    }

    // try {
    //     await startup();
    // } catch (error) {
    //     console.error(error);
    //     return;
    // }

    console.log("Bot started");
    bot.sendMessage(userChatID, "Bot started");

    const job = schedule.scheduleJob('0 1 * * *', () => {
        console.log("AutoClaiming dailies");
        claimAll();
    });


    bot.on("message", async (msg) => {
        let text = msg.text ?? "";
        const chatID = msg.chat.id;
        const Name = msg.chat.first_name;
        let fileId = null;

        const typingAction = () => bot.sendChatAction(chatID, 'typing');

        const typingInterval = setInterval(typingAction, 4000);
        try {

            if (fileId) {
                const filePath = await downloadFile(fileId);
                const base64 = await getFileAsBase64(filePath, false);
                let fileText = '';
                if (base64.mimeType.startsWith('image/')) {
                    fileText = `[[type:${base64.mimeType}, ${base64.base64}]]`;
                } else if (base64.mimeType === 'text/plain') {
                    fileText = fs.readFileSync(filePath, 'utf-8');
                } else if (base64.mimeType === 'application/pdf') {
                    fileText = `[[type:${base64.mimeType}, ${base64.base64}]]`;
                } else if (base64.mimeType === 'application/json') {
                    fileText = fs.readFileSync(filePath, 'utf-8');
                }
                if (msg.caption) fileText += `\n${msg.caption}`;
                text = fileText;
            }
            let chatHistory = await loadJsonFromFile(`${chatID}.json`, "chatHistory");
            if (!chatHistory) {
                chatHistory = [];
            }

            if (msg.document || msg.photo) {
                fileId = msg.document?.file_id ?? msg.photo[msg.photo.length - 1].file_id;
            }

            // if (fileId) {
            //     const filePath = await downloadFile(fileId);
            //     const base64 = await getFileAsBase64(filePath, false);
            //     let imageText = `[[type:${base64.mimeType}, ${base64.base64}]]`;
            //     if (msg.caption) imageText += `\n${msg.caption}`;
            //     text = imageText;
            // }

            if (text.startsWith("/wack") && !fileId) {
                chatHistory = [];
                await dumpJsonToFile(chatHistory, `${chatID}.json`, "chatHistory");
                bot.sendMessage(chatID, "Chat history cleared.");
                return;
            }

            if (text.startsWith("/tokens") && !fileId) {
                const args = getArgument(text);
                const tokens = getValidTokens(args.join(" ").trim().split(","));
                dumpJsonToFile(tokens, "tokens.json");
                bot.sendMessage(chatID, `Successfully stored ${tokens.length} tokens`);
                return;
            }

            if (text.startsWith("/claim") && !fileId) {
                claimAll();
                return;
            }

            if (text.startsWith("/generate") && !fileId) {
                const args = getArgument(text);
                if (args.length === 0) {
                    bot.sendMessage(chatID, "Please provide a prompt.");
                    return;
                }
                const messageID = (await bot.sendMessage(chatID, "Generating...")).message_id;

                const prompt = args.join(" ");
                let character = null;
                try {
                    character = await GenerateCharacter(prompt, chatID, messageID);
                } catch (error) {
                    console.error(error);
                    bot.editMessageText("An error occured while generating the character card.\n\n" + error, { chat_id: chatID, message_id: messageID });
                }
                await bot.sendDocument(chatID, character.source, { caption: character.name });
                chatHistory.push({ text: `[This message is invisible to the user. The user manually triggered a generation using /generate. This resulted in the generation of: ${character.name}.\nHere's its definitions:\n\n${character.description}]`, name: "System" });
                await dumpJsonToFile(chatHistory, `${chatID}.json`, "chatHistory");
                return;
            }

            if (text.startsWith("/images") && !fileId) {
                const prompt = getArgument(text).join(" ");
                const images = await generateImages(persistentPage, prompt, 'a[href="/model/1709400692714137270"]');
                for (const image of images) {
                    bot.sendDocument(chatID, image);
                }
                return;
            }

            if (text.startsWith("/getimageprompt") && !fileId) {
                const args = getArgument(text);
                if (args.length === 0) {
                    bot.sendMessage(chatID, "Please provide a character card.");
                    return;
                }
                const characterCard = args.join(" ");
                const imagePrompt = await characterToImagePrompt(characterCard);
                sendMessageInChunks(chatID, `Image generation prompt:\n\n\`\`\`characterPrompt\n${imagePrompt}\`\`\``, 'Markdown');
                return;
            }

            if (text.startsWith("/help") && !fileId) {
                const helpMessage = `
Here are the available commands:
/wack - Clear chat history.
/generate <prompt> - Generate a character card based on the provided prompt.
/images <prompt> - Generate images based on the provided prompt.
/getimageprompt <character card> - Get an image generation prompt from a character card.
/help - Display this help message.
                `;
                bot.sendMessage(chatID, helpMessage);
                return;
            }

            chatHistory.push({ text: text, name: Name });

            let prompt = "";

            const textPrompt = await loadTextFile("prompts\\prompt.txt");

            prompt += textPrompt + "\n\n";

            let formattedMessages = formatMessages(chatHistory);

            const instructionsTokens = (await model.countTokens(prompt)).totalTokens;

            formattedMessages = await formatStringForModel(formattedMessages, tokenLimit - instructionsTokens);

            formattedMessages.unshift(prompt);

            const response = removePrefix(await generateContentFromFormatterList(formattedMessages));




            //const response = removePrefix(await generateContentFromFormattedString(prompt));

            if (response.includes("DONE_COLLECTING")) {
                let generationPrompt = response.replaceAll("DONE_COLLECTING", "").replaceAll("`", "").replaceAll("Summary:", "").trim();
                const messageID = (await bot.sendMessage(chatID, "A character Generation has been triggered...")).message_id;
                delay(1000);
                try {
                    let character = null;
                    try {
                        character = await GenerateCharacter(generationPrompt, chatID, messageID);
                    } catch (error) {
                        console.error(error);
                        bot.editMessageText("An error occured while generating the character card.\n\n" + error, { chat_id: chatID, message_id: messageID });
                    }
                    console.log(character);
                    await bot.sendDocument(chatID, character.source, { caption: character.name });
                    chatHistory.push({ text: `[This message is invisible to the user, You generated a character with the name ${character.name}. Here's its definitions:\n\n${character.description}]`, name: "System" });
                    await dumpJsonToFile(chatHistory, `${chatID}.json`, "chatHistory");
                } catch (error) {
                    console.error(error);
                    bot.editMessageText("An error occured while generating the character card.", { chat_id: chatID, message_id: messageID });
                }
                finally {
                    return;
                }
            }
            chatHistory.push({ text: response, name: "Bot" });
            await dumpJsonToFile(chatHistory, `${chatID}.json`, "chatHistory");
            sendMessageInChunks(chatID, response, 'Markdown');
        }
        finally {
            clearInterval(typingInterval);
        }
    });


})();