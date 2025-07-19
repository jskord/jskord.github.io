import fs from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getChatGPTUpdate() {
  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are a daily news assistant.' },
      { role: 'user', content: 'Give me the estimated Ukraine war casualties today.' }
    ]
  });

  const result = chatCompletion.choices[0].message.content;
  fs.writeFileSync('daily-update.html', `<p>${result}</p>`);
}

getChatGPTUpdate();
