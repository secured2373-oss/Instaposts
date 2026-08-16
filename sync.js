import { GoogleGenAI } from '@google/genai';
import { Octokit } from '@octokit/rest';

export default async function handler(req, res) {
  // Allow cross-origin requests from your mobile app UI frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const urlParam = req.query.url || req.body.url;
  if (!urlParam || !urlParam.includes('instagram.com')) {
    return res.status(400).json({ error: 'Valid Instagram URL required' });
  }

  try {
    // 1. Initialize Gemini AI using your environment secret [1]
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = `Analyze this Instagram URL: ${urlParam}. Extract the core topic (e.g. Cooking, Fashion), specific items (ingredients/brands), and a 1-sentence search summary. Format strictly as text: TOPIC: X | DETAILS: Y | SUMMARY: Z`;
    
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    
    const aiTags = aiResponse.text.trim();
    const currentDate = new Date().toISOString().split('T')[0];

    // 2. Initialize GitHub Client to fetch and update your private database file
    const octokit = new Octokit({ auth: process.env.MY_GITHUB_TOKEN });
    const owner = process.env.GITHUB_USER;
    const repo = process.env.GITHUB_REPO;
    const path = 'my_instagram_links_vault.json';

    // Retrieve existing data file context from GitHub
    let currentFile;
    let dbContent = [];
    try {
      currentFile = await octokit.repos.getContent({ owner, repo, path });
      const rawText = Buffer.from(currentFile.data.content, 'base64').toString('utf-8');
      dbContent = JSON.parse(rawText);
    } catch (err) {
      // If the file is fresh/blank, fallback to an empty array
      dbContent = [];
    }

    // Check if the link already exists in your vault
    if (dbContent.some(item => item.url === urlParam)) {
      return res.status(200).json({ message: 'Post already exists in vault' });
    }

    // Append new structured post card object
    dbContent.push({
      url: urlParam,
      date: currentDate,
      tags: aiTags
    });

    // 3. Write updated database back to your GitHub Repository securely
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Mobile Automation: Added new post ${currentDate}`,
      content: Buffer.from(JSON.stringify(dbContent, null, 2)).toString('base64'),
      sha: currentFile ? currentFile.data.sha : undefined
    });

    return res.status(200).json({ success: true, tags: aiTags });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}

