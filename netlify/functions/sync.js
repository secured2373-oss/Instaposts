import { GoogleGenAI } from '@google/genai';

import { Octokit } from '@octokit/rest';

export default async (req, context) => {
  // Handle CORS options headers safely
  if (req.method === 'OPTIONS') {
    return new Response('OK', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  // Parse incoming Instagram parameters safely
  let urlParam = '';
  try {
    const urlObj = new URL(req.url);
    urlParam = urlObj.searchParams.get('url');
    if (!urlParam && req.method === 'POST') {
      const body = await req.json();
      urlParam = body.url;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed parsing parameters' }), { status: 400 });
  }

  if (!urlParam || !urlParam.includes('instagram.com')) {
    return new Response(JSON.stringify({ error: 'Valid Instagram URL parameter required' }), { status: 400 });
  }

  try {
    // 1. Fire up Gemini 2.5 Flash using Environment Secret
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `Analyze this Instagram URL: ${urlParam}. Extract core topic, specific items (ingredients/brands), and a 1-sentence summary. Format strictly as text: TOPIC: X | DETAILS: Y | SUMMARY: Z`;
    
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const aiTags = aiResponse.text.trim();
    const currentDate = new Date().toISOString().split('T')[0];

    // 2. Authenticate to GitHub via personal secrets token
    const octokit = new Octokit({ auth: process.env.MY_GITHUB_TOKEN });
    const owner = process.env.GITHUB_USER;
    const repo = process.env.GITHUB_REPO;
    const path = 'my_instagram_links_vault.json';

    let currentFile;
    let dbContent = [];
    try {
      currentFile = await octokit.repos.getContent({ owner, repo, path });
      const rawText = Buffer.from(currentFile.data.content, 'base64').toString('utf-8');
      dbContent = JSON.parse(rawText);
    } catch (err) {
      dbContent = [];
    }

    if (dbContent.some(item => item.url === urlParam)) {
      return new Response(JSON.stringify({ message: 'Link already exists' }), { status: 200 });
    }

    dbContent.push({ url: urlParam, date: currentDate, tags: aiTags });

    // 3. Write data back to GitHub
    await octokit.repos.createOrUpdateFileContents({
      owner, repo, path,
      message: `Netlify Automation: Added new post ${currentDate}`,
      content: Buffer.from(JSON.stringify(dbContent, null, 2)).toString('base64'),
      sha: currentFile ? currentFile.data.sha : undefined
    });

    return new Response(JSON.stringify({ success: true, tags: aiTags }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
