import fs from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getChatGPTUpdate() {
  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant summarizing global events using your extensive knowledge and reasoning. You are allowed to make reasonable inferences about yesterday based on known trends, public reporting, and history.'
      },
      {
        role: 'user',
        content: 'Estimate the Ukraine war casualties for yesterday and give the date that yesterday was. Be as specific as possible using your knowledge of past daily casualty reports and patterns. If data is unclear, explain your reasoning.'
      }
    ]
  });

  const result = chatCompletion.choices[0].message.content;
  fs.writeFileSync('daily-update.html', `<p>${result}</p>`);
}

getChatGPTUpdate();

