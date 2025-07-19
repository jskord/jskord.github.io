import fs from 'fs';
import { Configuration, OpenAIApi } from 'openai';

const config = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(config);

const res = await openai.createChatCompletion({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a brief daily news bot.' },
    { role: 'user', content: 'Give me the estimated Ukraine war casualties for yesterday.' }
  ]
});

const result = res.data.choices[0].message.content;

// Save to a file your website can use
fs.writeFileSync('daily-update.html', `<p>${result}</p>`);
