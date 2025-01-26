import fetch from 'node-fetch';
import sharp from 'sharp';

const API_ENDPOINT = 'https://api.pixai.art/graphql';

async function claimDailyQuota(token) {
  const query = `
      mutation dailyClaimQuota {
        dailyClaimQuota
      }
    `;

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': '*/*',
        'origin': 'https://pixai.art',
        'referer': 'https://pixai.art/',
        'authorization': `Bearer ${token}`,

      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();

    if (data && data.errors) {
      const errorMessage = data.errors[0]?.message;

      if (errorMessage && errorMessage.includes('already claimed')) {
        return false; // Claim failed due to already being claimed
      }
      // If there are errors and it's not about "already claimed"
      return false;
    }
    else {
      return true; // Claim successful
    }



  } catch (error) {
    throw error; // Re-throw the error
  }
}

async function getMyQuota(token) {
  const query = `
      query getMyQuota {
        me {
          quotaAmount
        }
      }
    `;

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': '*/*',
        'origin': 'https://pixai.art',
        'referer': 'https://pixai.art/',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json()
    if (data && data.data && data.data.me && data.data.me.quotaAmount) {
      return parseInt(data.data.me.quotaAmount, 10);
    }
    throw new Error('Error getting quota amount, or missing quotaAmount');


  } catch (error) {
    throw error; // Re-throw the error

  }
}


async function generatePixaiImage(pixaiToken, prompt, modelID, loras = {}, negativePrompt = null) {
  await setOver18Preference(pixaiToken);
  const graphqlUrl = 'https://api.pixai.art/graphql';
  const query = `
    mutation createGenerationTask($parameters: JSONObject!) {
      createGenerationTask(parameters: $parameters) {
        id 
      }
    }
  `;

  if (!negativePrompt) {
    negativePrompt = "NSFW, worst quality, bad quality, low quality, lowres, scan artifacts, jpeg artifacts, sketch, (worst quality, bad quality:1.1), lowres, jpeg, artifacts, signature, username, text, logo, bad anatomy, artist name, artist logo, extra limbs, extra digit, extra legs, extra legs and arms, disfigured, missing arms, too many fingers, fused fingers, missing fingers, unclear eyes, blur, film grain, noise,";
  }
  // {
  //   "1748998561833317556": 0.7 
  // }


  const variables = {
    parameters: {
      prompts: prompt,
      extra: {},
      priority: 1000,
      width: 768,
      height: 1280,
      modelId: modelID, // Replace with your desired model ID if different
      negativePrompts: negativePrompt,
      samplingSteps: 25,
      samplingMethod: "Euler a",
      cfgScale: 6,
      seed: "",
      clipSkip: 2,
      lora: loras,
      batchSize: 4,
      controlNets: [],
      lightning: false,
      adult: true
    }
  };


  const requestOptions = {
    method: 'POST',
    headers: {
      'authority': 'api.pixai.art',
      'scheme': 'https',
      'accept': '*/*',
      'accept-encoding': 'gzip, deflate, br, zstd', // Important for handling compressed responses
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'origin': 'https://pixai.art',
      'referer': 'https://pixai.art/',
      'sec-ch-ua': '"Google Chrome";v="117", "Not;A=Brand";v="8", "Chromium";v="117"', // Update as needed
      'sec-ch-ua-mobile': '?0',             // Update as needed
      'sec-ch-ua-platform': '"Windows"',    // Update as needed
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36', // Update as needed
      'authorization': `Bearer ${pixaiToken}`, // Add the authorization header
    },
    body: JSON.stringify({ query, variables }),
  };

  try {
    const response = await fetch(graphqlUrl, requestOptions);
    if (!response.ok) {
      const errorBody = await response.text(); // Get the error response body
      throw new Error(`PixAI API request failed with status ${response.status}: ${errorBody}`);
    }
    const data = await response.json();

    if (data.data && data.data.createGenerationTask && data.data.createGenerationTask.id) {
      return data.data.createGenerationTask.id; // Return the Generation ID
    } else {
      throw new Error('Generation ID not found in API response'); // Or handle the error as you see fit
    }

  } catch (error) {
    throw error; // Re-throw if you want the calling function to handle it
  }
}

async function getPixaiImageUrls(pixaiToken, taskId) {
  const graphqlEndpoint = 'https://api.pixai.art/graphql';
  const query = `
  query getTaskById($id: ID!) {
    task(id: $id) {
      ...TaskBase
    }
  }
  
  fragment TaskBase on Task {
    id
    artworks {
        id
        media {
            id
            urls {
                variant
                url
            }
        }
    }
    media {
      id
      urls {
        variant
        url
      }
    }
  }
  `;

  const variables = { id: taskId };

  try {
    const response = await fetch(graphqlEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pixaiToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} - ${response.statusText} - ${errorData}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }
    if (!data.data || !data.data.task || !data.data.task.media) {
      throw new Error(`Task or media not found for ID: ${taskId}`);
    }

    // Extract the public URL
    const publicUrl = data.data.task.media.urls.find(urlObj => urlObj.variant === 'PUBLIC')?.url;
    if (!publicUrl) {
      throw new Error("Public URL not found in the response.");
    }

    // Download the image
    const imageResponse = await fetch(publicUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download the image: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.buffer();

    // Split and process the image
    const imageUrls = await splitImageIntoBase64Parts(imageBuffer);
    return imageUrls;

  } catch (error) {
    throw error;
  }
}

async function splitImageIntoBase64Parts(buffer) {
  // Determine the actual dimensions of the image
  const metadata = await sharp(buffer).metadata();
  const imgWidth = metadata.width;
  const imgHeight = metadata.height;

  // Calculate the part dimensions by splitting the image in 2 horizontally and vertically
  const partWidth = Math.floor(imgWidth / 2);
  const partHeight = Math.floor(imgHeight / 2);

  // Split the image into 4 equal parts
  const parts = [];
  for (let y = 0; y < imgHeight; y += partHeight) {
    for (let x = 0; x < imgWidth; x += partWidth) {
      const partBuffer = await sharp(buffer)
        .extract({
          left: x,
          top: y,
          width: partWidth,
          height: partHeight,
        })
        .toBuffer();
      const base64 = `data:image/png;base64,${partBuffer.toString('base64')}`;
      parts.push(base64);
    }
  }
  return parts;
}



async function setOver18Preference(token) {
  const url = 'https://api.pixai.art/graphql';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  const body = {
      "query": `
          mutation setPreferences($value: JSONObject!) {
            setPreferences(value: $value)
          }
      `,
    "variables": {
        "value": {
            "ageVerificationStatus": "OVER18"
        }
    }
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Body: ${errorText}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
      throw error;
  }
}








export { claimDailyQuota, getMyQuota, generatePixaiImage, getPixaiImageUrls };