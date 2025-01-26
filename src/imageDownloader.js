import path from 'path';
import fs from 'fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

/**
 * Downloads an image from a URL or decodes a base64 string, auto-detects its type,
 * and optionally converts it to a specified format.
 *
 * @param {string} imageUrl - The URL of the image to download or a base64-encoded image string.
 * @param {string} [folderName="images"] - Optional folder name to save the image in (defaults to "images").
 * @param {string} [targetExtension] - Optional target extension to convert the image to (e.g., ".png").
 * @returns {Promise<string>} - A promise that resolves with the absolute path of the downloaded file,
 * or rejects with an error if processing fails.
 */
export async function downloadImage(imageUrl, folderName = 'images', targetExtension) {
    try {
        // 1. Create the download folder if it doesn't exist
        const absoluteFolderPath = path.resolve(folderName);
        await fs.mkdir(absoluteFolderPath, { recursive: true });

        let imageBuffer;
        let ext;

        if (imageUrl.startsWith('data:')) {
            // Handle base64 URL
            const match = imageUrl.match(/^data:(.*?);base64,(.*)$/);
            if (!match) {
                throw new Error('Invalid base64 image format.');
            }

            const mimeType = match[1];
            const base64Data = match[2];
            imageBuffer = Buffer.from(base64Data, 'base64');

            // Detect file type from buffer
            const fileTypeResult = await fileTypeFromBuffer(imageBuffer);
            if (fileTypeResult && fileTypeResult.ext) {
                ext = fileTypeResult.ext;
            } else {
                throw new Error('Could not determine file type from base64 data');
            }
        } else {
            // Handle regular URL
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
            }

            // Get image as a Buffer
            imageBuffer = await response.buffer();

            // Determine file type
            const fileTypeResult = await fileTypeFromBuffer(imageBuffer);
            if (fileTypeResult && fileTypeResult.ext) {
                ext = fileTypeResult.ext;
            } else {
                throw new Error('Could not determine file type from URL or buffer.');
            }
        }

        // 2. Determine the target extension for conversion
        const targetExt = targetExtension ? (targetExtension.startsWith('.') ? targetExtension.slice(1) : targetExtension) : ext;

        // 3. Generate a unique filename
        const uniqueFilename = `${Date.now()}_downloaded.${targetExt}`;
        const imagePath = path.join(absoluteFolderPath, uniqueFilename);

        // 4. Convert and re-encode if a target extension is specified
        if (targetExtension) {
            try {
                imageBuffer = await sharp(imageBuffer).toFormat(targetExt).toBuffer();
                ext = targetExt; // Update the extension to the target type
            } catch (conversionError) {
                throw new Error(`Failed to convert image to ${targetExt}: ${conversionError.message}`);
            }
        }

        // 5. Save the processed image to disk
        await fs.writeFile(imagePath, imageBuffer);

        // 6. Re-encode as base64 with the correct header
        const base64Header = `data:image/${ext};base64,`;
        const base64Image = base64Header + imageBuffer.toString('base64');

        console.log(`Image successfully processed and saved at ${imagePath}`);
        console.log(`Base64 re-encoded with correct headers: ${base64Header}`);

        // 7. Return the absolute file path
        return imagePath;
    } catch (error) {
        console.error('Error downloading image:', error);
        throw error; // Re-throw error to be handled by the caller
    }
}
