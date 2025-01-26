import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath } from 'puppeteer';

import { downloadImage } from './imageDownloader.js';
import { Lock } from './lock.js';
import { delay } from './utils.js';
import { dumpJsonToFile, loadJsonFromFile } from './JSONmanager.js';


import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { claimDailyQuota, getMyQuota, generatePixaiImage, getPixaiImageUrls } from '../newPixai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

puppeteer.use(StealthPlugin());

const profileSelector = 'a.flex-none.h-6.px-1.flex.items-center.no-underline.rounded-\\[3px\\]';

const promptTextArea = 'section.z-10.px-4.py-3.pb-2.rounded-xl.mx-4.flex.flex-col > textarea[placeholder="Enter prompts here"]';

const modelHref = 'a[href="/model/1709400692714137270"]';

const loraHref = 'a[href="/model/1748998561791374515"]';

const loraURL = 'https://pixai.art/generator/image?initialValues=gqdwcm9tcHRzq0V4cHJlc3NpdmVopGxvcmGBszE3NDg5OTg1NjE4MzMzMTc1NTbLP-ZmZmZmZmY%3D';

const loadedLora = "a[href='/model/1748998561791374515/1748998561833317556']";

export const pixaiSite = 'https://pixai.art/generator/image';

let browser = {};


export async function getNewPage(token, headless = true) {
    if (!browser[token]) {
        browser[token] = await puppeteer.launch({
            headless: headless,
            executablePath: executablePath(),
        });
    }
    return browser[token].newPage();
}

export async function closeBrowser(token) {
    if (browser[token]) {
        await browser[token].close();
        delete browser[token];
    }
}

export async function getPointsRemaining(page) {
    await page.goto(pixaiSite, { waitUntil: 'domcontentloaded' });

    const numberFlowSelector = 'span.inline-flex > a > span > span > number-flow-react';

    await page.waitForSelector(numberFlowSelector, { timeout: 10000 });

    let result = null;
    let retries = 0;

    while (result === null && retries < 10) {
        try {
            const numberFlowElement = await page.$(numberFlowSelector);
            if (!numberFlowElement) {
                result = null;
                break;
            }
            const ariaLabel = await numberFlowElement.evaluate(element => element.getAttribute('aria-label'));
            result = ariaLabel ? parseInt(ariaLabel.replace(/,/g, ''), 10) : null;

            if (result != null) {
                break;
            }

        } catch (error) {
            // Handle error if needed
        }

        retries++;
        await delay(1000);
    }

    return result;
}

async function configurePageForVisibility(page) {
    if (!page) {
        return;
    }
    await page.evaluateOnNewDocument(() => {
        // Override visibilityState
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible',
        });

        // Override document.hidden
        Object.defineProperty(document, 'hidden', {
            get: () => false,
        });


        // Override focus events
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('focus'));

        // Override requestAnimationFrame
        const originalRequestAnimationFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => originalRequestAnimationFrame(callback);

        //Override settimeout and setinterval
        const originalSetTimeout = window.setTimeout;
        const originalSetInterval = window.setInterval
        window.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, 0, ...args);
        window.setInterval = (callback, delay, ...args) => originalSetInterval(callback, 0, ...args);


    });

    // Force a consistent viewport
    await page.setViewport({ width: 1280, height: 720 });


    await page.evaluate(() => {

        //Force webgl context
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                console.log("WebGL context found, force refresh");
                gl.getExtension("WEBGL_lose_context")?.restoreContext();
            }
        }
        catch (error) {
            console.log("could not get webgl");
        }

    });


}

const lock = new Lock();
export async function generateImages(page, prompt, modelHref) {
    await lock.acquire();
    await configurePageForVisibility(page);
    const images = [];
    let timeout = 0;
    try {
        await page.goto("https://www.google.com/", { waitUntil: 'domcontentloaded' });
        await page.goto(loraURL, { waitUntil: 'domcontentloaded' });
        if (!await isLoggedIn(page)) {
            console.log("Not logged in. Exiting.");
            return;
        }

        timeout = setTimeout(() => {
            return [];
        }, 60000);

        await page.waitForSelector(loadedLora);


        await page.waitForSelector(promptTextArea);

        await page.focus(promptTextArea);
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        await page.type(promptTextArea, prompt);

        await page.waitForSelector(modelHref);
        await page.click(modelHref);

        await page.click(promptTextArea);

        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');

        const imagesUrls = await getImagesOnceGeneration(page);
        clearTimeout(timeout);
        for (const image of imagesUrls) {
            images.push(await downloadImage(image, "downloads", ".png"));
        }

    }
    finally {
        lock.release();
        if (timeout) {
            clearTimeout(timeout);
        }
    }


    return images;
}

async function gotoUserProfile(page) {
    try {
        await configurePageForVisibility(page);
        await page.waitForSelector(profileSelector, { waitUntil: 'domcontentloaded' });
    } catch (error) {
        return false;
    }
    const userUrl = await page.$eval(profileSelector, (element) => element.getAttribute('href'));

    // Build the full user URL
    const fullUserUrl = `https://pixai.art${userUrl}/artworks`;

    await page.goto(fullUserUrl, { waitUntil: 'domcontentloaded' });
    return true;
}

async function getImagesOnceGeneration(page) {
    let doneGenerating = false;
    await configurePageForVisibility(page);

    while (!doneGenerating) {
        const images = await extractImageUrlsFromPage(page);
        if (images) {
            const areUselessImages = images.some(item => item.toLowerCase().endsWith('.gif')) || images.every(item => item === images[0]);
            if (!areUselessImages) {
                if (images.length < 4) {
                    await delay(1000);
                    continue;
                }
                doneGenerating = true;
                return images;
            }
        }

        await delay(1000);

    }



}
async function extractImageUrlsFromPage(page) {
    const imageUrls = await page.$$eval(
        'div.isolate > div > div > div > div > div > img',  // More specific selector
        imgs => imgs.map(img => img.src)
    );
    return imageUrls;
}

export async function loginWithToken(page, token, maxAttempts = 3) {
    let attempts = 0;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            await page.goto(pixaiSite, { waitUntil: 'domcontentloaded' });

            await page.evaluate((token) => {
                localStorage.setItem('https://api.pixai.art:token', token);
            }, token);

            await page.goto(pixaiSite);

            const logged = await isLoggedIn(page); // Pass page object


            if (logged) {
                console.log("Successfully logged in (profile indicator found).");
                return true;
            } else {
                console.log("Profile indicator not found. Retrying...");
            }
        } catch (error) {
            console.error(`Attempt ${attempts} failed:`, error);
        }
    }

    console.log("Max login attempts reached. Giving up.");
    return false;
}

export async function logOut(page) {
    await page.goto(pixaiSite);
    await page.evaluate(() => {
        localStorage.removeItem('https://api.pixai.art:token');
    });
    await page.goto(pixaiSite);
    return !await isLoggedIn(page);
}

export async function isLoggedIn(page) { // Add page parameter
    await configurePageForVisibility(page);
    const profileIndicatorSelector = 'span.MuiBadge-root > div.bg-gradient-to-br'; // Selector for the profile indicator
    const isLoggedIn = await page.waitForSelector(profileIndicatorSelector, { timeout: 5000, hidden: false })
        .then(() => true)
        .catch(() => false);

    return isLoggedIn;
}
export async function claimDailyReward(page) { // Add page parameter
    await page.goto(pixaiSite, { waitUntil: 'domcontentloaded' });
    await gotoUserProfile(page);
    await configurePageForVisibility();
    const claimSelector = 'div.py-3.flex.items-center.gap-3.text-sm.border.border-zinc-500\\/50.rounded-lg.col-start-1';

    try {
        await page.waitForSelector(claimSelector, { timeout: 5000 });
    } catch (error) {
        return "Already claimed or not available.";
    }

    const claimElement = await page.$(claimSelector);

    if (claimElement) {
        const buttonSelector = `${claimSelector} button`;
        const isClaimed = await page.$eval(buttonSelector, (button) => {
            const isDisabled = button.disabled;
            const text = button.textContent.trim();
            return isDisabled && text === 'Claimed';
        });

        if (isClaimed) {
            return 'Daily claim has already been claimed.';
        } else {
            await page.click(buttonSelector);
            return 'Daily claim successfully claimed.';
        }
    } else {
        return 'Daily claim section is not found.';
    }
}


export async function storeCredits(tokens) {
    let credits = {};
    for (const token of tokens) {
        try {
            const points = await getMyQuota(token);
            credits[token] = points;
        }
        catch (error) {
            credits[token] = null;
        }
    }
    dumpJsonToFile(credits, "credits.json");
    closeBrowser("storeCredits");
    return credits;
}

let currentToken = await loadJsonFromFile("bestToken.json") || null;
export async function getBestToken(tokens) {
    if (!tokens) {
        return null;
    }
    let bestToken = await loadJsonFromFile("bestToken.json") || null;
    if (currentToken) {
        if (tokens[currentToken] > 10000) {
            return currentToken;
        }
    }
    let bestCredits = 0;
    for (const [token, credits] of Object.entries(tokens)) {
        if (credits > bestCredits) {
            bestCredits = credits;
            bestToken = token;
        }
    }
    currentToken = bestToken;
    dumpJsonToFile(bestToken, "bestToken.json");
    return bestToken;
}


// Check if this module is the main module
const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] === currentFile) {
    const tokens = await loadJsonFromFile("tokens.json");
    const credits = await storeCredits(tokens);
    const bestToken = await getBestToken(credits);

    const generationID = await generatePixaiImage(bestToken, "Expressiveh\nOne Person\nGirl\nJapanese School Uniform\n18+\nnaked", "1811528826405408057", { "1748998561833317556": 0.7 });

} else {
    console.log("This script is being imported as a module (ES Module).");
}