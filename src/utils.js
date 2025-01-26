import fs from 'fs';
import mime from 'mime-types';
import path from 'path';

export async function getFileAsBase64(filePath, onlyBase64 = false) {
    try {
        const fileData = await fs.promises.readFile(filePath);
        const base64String = fileData.toString('base64');
        const mimeType = mime.lookup(filePath); // Get MIME type

        if (!mimeType) {
            console.error(`Could not determine MIME type for ${filePath}`);
            return null; // Or throw an error if you prefer
        }

        if (onlyBase64) {
            return base64String;
        }

        return {
            base64: base64String,
            mimeType: mimeType,
        };
    } catch (error) {
        console.error(`Error reading or encoding file: ${error.message}`);
        return null; // Or throw the error
    }
}
export async function loadTextFile(path) {
    try {
        const data = await fs.promises.readFile(path, 'utf8');
        return data;
    } catch (err) {
        if (err.code === 'ENOENT') {  // File not found
            return undefined;
        }
        console.error('Error reading file:', err);
        throw err;  // Rethrow if it's a different error
    }
}

export function markdownToMarkdownV2(markdown) {
    // Escape special characters for Telegram MarkdownV2
    const escapeMarkdownV2 = (text) => {
        return text.replace(/([\\_*[\]()>#+-.!])/g, '\\$1');
    };

    // Convert Markdown to MarkdownV2
    let parsedMarkdown = markdown;

    // Handle bold (**text**) -> *text*
    parsedMarkdown = parsedMarkdown.replace(/\*\*(.*?)\*\*/g, (match, p1) => {
        return '*' + escapeMarkdownV2(p1) + '*';
    });
    
    // Handle italic (*text*) -> _text_
    parsedMarkdown = parsedMarkdown.replace(/\*(.*?)\*/g, (match, p1) => {
        return '_' + escapeMarkdownV2(p1) + '_';
    });
    
    // Handle strikethrough (~~text~~) -> ~text~
    parsedMarkdown = parsedMarkdown.replace(/~~(.*?)~~/g, (match, p1) => {
        return '~' + escapeMarkdownV2(p1) + '~';
    });

    // Handle inline code (`code`) -> `code`
    parsedMarkdown = parsedMarkdown.replace(/`(.*?)`/g, (match, p1) => {
        return '`' + escapeMarkdownV2(p1) + '`';
    });

    // Handle links ([text](url)) -> [text](url)
    parsedMarkdown = parsedMarkdown.replace(/\[([^\]]+)\]\((.*?)\)/g, (match, p1, p2) => {
        return `[${escapeMarkdownV2(p1)}](${escapeMarkdownV2(p2)})`;
    });

    // Handle code blocks (```code```) -> ```code```
    parsedMarkdown = parsedMarkdown.replace(/```([\s\S]*?)```/g, (match, p1) => {
        return '```' + escapeMarkdownV2(p1) + '```';
    });

    return parsedMarkdown;
}

export function extractChosenImage(output) {
    const match = output.match(/CHOSEN_IMAGE\s*=\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null; // Return the number or null if not found
}




export async function copyFile(filePath, destinationFolder, newFileName) {
    try {
      // Ensure the destination folder exists
      await fs.promises.mkdir(destinationFolder, { recursive: true });
  
      let destinationPath = path.join(destinationFolder, newFileName);
      let index = 0;
  
      // Check if the file already exists, and if so, append an index to the new filename
      while (fs.existsSync(destinationPath)) {
        const extname = path.extname(newFileName);
        const basename = path.basename(newFileName, extname);
        const newFileNameWithIndex = `${basename}(${index})${extname}`;
        destinationPath = path.join(destinationFolder, newFileNameWithIndex);
        index++;
      }
  
      // Copy the file to the destination folder
      await fs.promises.copyFile(filePath, destinationPath);
      console.log(`File copied successfully to ${destinationPath}`);
  
      // Return the path to the output file
      return destinationPath;
    } catch (err) {
      console.error('Error during file copy:', err);
      throw err;
    }
  }

export const delay = ms => new Promise(res => setTimeout(res, ms));