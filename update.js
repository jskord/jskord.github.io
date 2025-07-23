import fs from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getHistoricalNews() {
  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'You are a newspaper editor from 1925. Write a front-page news brief dated exactly 100 years ago today. Include at least two global or national stories, and one cultural or scientific note. Write it in the tone of a 1920s newspaper, but keep it clear for a modern reader. Please style the with html look like an actual news paper front page.'
      },
      {
        role: 'user',
        content: `What was the news on this day 100 years ago — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}?`
      }
    ]
  });

  const result = chatCompletion.choices[0].message.content;
  fs.writeFileSync('historical-news.html', `<p>${result}</p>`);
}

getHistoricalNews();


