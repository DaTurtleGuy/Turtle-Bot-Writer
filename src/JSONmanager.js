import fs from 'fs';
import path from 'path';

// Helper function to load JSON or JSONL from a file
export async function loadJsonFromFile(filename, folderPath = "JSONs") {
  const filePath = path.join(folderPath, filename);
  
  try {
    // Check if the file exists before attempting to read it
    await fs.promises.access(filePath, fs.constants.F_OK);
    const data = await fs.promises.readFile(filePath, 'utf-8');
    if (filename.endsWith('.jsonl')) {
      return data.split('\n').filter(line => line).map(line => JSON.parse(line));
    }
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; 
    }
    throw new Error(`Error loading file: ${error.message}`);
  }
}

export async function dumpJsonToFile(data, filename, folderPath = "JSONs", isJsonl = false) {
  let filePath;

  if (!folderPath || typeof folderPath !== 'string') {
      // If folderPath is null or invalid, assume filename includes the full path
      filePath = filename;
  } else {
      // Combine folderPath and filename into a full path
      filePath = path.join(folderPath, filename);
  }

  try {
      if (folderPath && typeof folderPath === 'string') {
          // Create folder if it doesn't exist
          await fs.promises.mkdir(folderPath, { recursive: true });
      }

      // Prepare the content to be written
      const content = isJsonl
          ? data.map(item => JSON.stringify(item)).join('\n') + '\n'
          : JSON.stringify(data, null, 2);

      // Write the content to the file
      await fs.promises.writeFile(filePath, content, 'utf-8');
      console.log(`Data saved to ${filePath}`);
  } catch (error) {
      // Log the error and provide feedback without throwing
      console.error(`Error saving file: ${error.message}`);
  }
}