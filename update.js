// update.js

// 1. Load environment variables from .env file for local development.
// This must be the very first executable line to ensure environment variables are loaded before other imports.
// In GitHub Actions, the API key is passed directly as an environment variable by the workflow,
// so dotenv will safely not interfere or attempt to load a .env file that isn't there.
import 'dotenv/config';

// 2. Import necessary modules
import OpenAI from 'openai'; // For interacting with the OpenAI API
import { promises as fs } from 'fs'; // For asynchronous file system operations (reading/writing files)

// 3. Initialize the OpenAI client
// The OpenAI constructor automatically checks process.env.OPENAI_API_KEY if no apiKey is provided.
// This is why setting the env var (either via .env or GitHub Actions) is crucial.
const openai = new OpenAI();

// 4. Define the output file path
const OUTPUT_FILE = 'historical-news.html';

// 5. Main asynchronous function to generate content and save it
async function generateAndSaveContent() {
  try {
    console.log('Starting content generation...');

    // --- Customize your OpenAI API call here ---
    // This is where you define the question/prompt for the AI.
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Recommended efficient model. You can change to "gpt-3.5-turbo", "gpt-4", etc.
      messages: [
        { role: "system", content: "You are a journalist from 100 years ago today. " },
        { role: "user", content: "Generate a summary of world news from 100 years ago today. Add a relevant illustration to go with the brief summary" },
      ],
      temperature: 0.8, // Higher temperature for more creative/diverse outputs
      max_tokens: 120, // Max tokens for the response to keep it concise
    });

    const generatedFact = completion.choices[0].message.content.trim();
    console.log('Generated Fact:', generatedFact);

    // 6. Get the current date and time for the "Updated" timestamp
    // Using current time in Racine, Wisconsin (CDT)
    const now = new Date();
    const formattedDate = now.toLocaleString('en-US', {
        timeZone: 'America/Chicago', // Central Daylight Time (CDT)
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });

    // 7. Prepare the full HTML content to be written to the file
    // This template includes basic styling and the generated fact.
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daily Historical News</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 2em; line-height: 1.6; color: #333; }
        .fact-container {
            background-color: #f0f8ff; /* Alice Blue */
            border: 1px solid #cce7ff; /* Lighter blue border */
            border-left: 8px solid #007bff; /* Primary blue left border */
            border-radius: 8px;
            margin: 1.5em 0;
            padding: 1.5em 2em;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            max-width: 700px;
            margin-left: auto;
            margin-right: auto;
        }
        .fact-text {
            font-size: 1.2em;
            font-weight: bold;
            color: #212529;
            margin-bottom: 0.8em;
        }
        .fact-date {
            font-size: 0.85em;
            color: #6c757d;
            text-align: right;
            margin-top: 1em;
            border-top: 1px dashed #e9ecef;
            padding-top: 0.5em;
        }
        h1 {
            color: #0056b3;
            text-align: center;
            margin-bottom: 1em;
        }
    </style>
</head>
<body>
    <h1>Today's Historical News Fact</h1>
    <div class="fact-container">
        <p class="fact-text">${generatedFact}</p>
        <div class="fact-date">Updated: ${formattedDate}</div>
    </div>
</body>
</html>
    `.trim(); // .trim() removes leading/trailing whitespace from the template literal

    // 8. Write the HTML content to the specified file
    await fs.writeFile(OUTPUT_FILE, htmlContent);
    console.log(`Successfully wrote content to ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Error during content generation or file write:', error);

    // 9. If an error occurs, write an error message to the HTML file
    // This ensures your webpage always displays something, even on failure.
    const now = new Date();
    const formattedDate = now.toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });
    const errorMessageContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 2em; line-height: 1.6; color: #333; }
        .error-container {
            background-color: #ffe0e0; /* Light red background */
            border: 1px solid #ff9999; /* Red border */
            border-left: 8px solid #dc3545; /* Darker red left border */
            border-radius: 8px;
            margin: 1.5em 0;
            padding: 1.5em 2em;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            max-width: 700px;
            margin-left: auto;
            margin-right: auto;
        }
        .error-message {
            font-size: 1.1em;
            color: #dc3545;
            margin-bottom: 0.8em;
        }
        .error-details {
            font-size: 0.9em;
            color: #6c757d;
            border-top: 1px dashed #ffcccb;
            padding-top: 0.5em;
            margin-top: 1em;
        }
        .fact-date {
            font-size: 0.85em;
            color: #6c757d;
            text-align: right;
            margin-top: 1em;
            border-top: 1px dashed #e9ecef;
            padding-top: 0.5em;
        }
    </style>
</head>
<body>
    <h1>Error Generating Content</h1>
    <div class="error-container">
        <p class="error-message">We apologize, but there was an issue generating the daily historical news fact.</p>
        <p class="error-message">Please check back later!</p>
        <p class="error-details">Error details: ${error.message}</p>
        <div class="fact-date">Updated: ${formattedDate}</div>
    </div>
</body>
</html>
    `.trim();
    await fs.writeFile(OUTPUT_FILE, errorMessageContent).catch(e => console.error("Failed to write error message to file:", e));
    process.exit(1); // Exit with a non-zero code to signal failure to GitHub Actions
  }
}

// 10. Execute the main function when the script runs
generateAndSaveContent();