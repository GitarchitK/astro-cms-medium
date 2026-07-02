import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';
import { submitToGoogleIndexing } from '../../../lib/google-api';
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || import.meta.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY || import.meta.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET || import.meta.env.CLOUDINARY_API_SECRET,
  secure: true
});

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

function cleanJsonString(str: string): string {
  return str
    .replace(/^```json\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

function cleanSectionOutput(html: string, heading: string): string {
  let cleaned = html.replace(/^```html\s*/i, '').replace(/```$/, '').trim();
  
  // Strip leading h1/h2/h3/h4/h5/h6 tag if it duplicates the section heading (case-insensitive, optional whitespaces/newlines)
  const escapedHeading = heading.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const htmlHeadingRegex = new RegExp(`^\\s*<h[1-6]>\\s*${escapedHeading}\\s*</h[1-6]>(\\s*<br\\s*/?>)*`, 'i');
  const markdownHeadingRegex = new RegExp(`^\\s*#+\\s*${escapedHeading}\\s*(\\r?\\n|$)`, 'i');
  
  cleaned = cleaned.replace(htmlHeadingRegex, '').replace(markdownHeadingRegex, '').trim();
  return cleaned;
}

function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

async function getSiteUrl() {
  let siteUrl = 'https://mershal.in';
  if (!adminDb) return siteUrl;
  try {
    const settingsDoc = await adminDb.collection('settings').doc('general').get();
    if (settingsDoc.exists) {
      siteUrl = settingsDoc.data()?.siteUrl || 'https://mershal.in';
    }
  } catch (e) {
    console.warn('Could not load siteUrl from settings:', e);
  }
  return siteUrl.replace(/\/$/, '');
}

async function fetchGoogleSuggestions(keyword: string): Promise<string[]> {
  const variations = [
    keyword,
    `how to ${keyword}`,
    `${keyword} error`,
    `${keyword} not working`,
    `problem with ${keyword}`,
    `${keyword} tutorial`
  ];
  
  const suggestions = new Set<string>();
  
  for (const query of variations) {
    try {
      const url = `http://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data[1])) {
          data[1].forEach((s: string) => suggestions.add(s));
        }
      }
    } catch (e) {
      console.error(`Failed to fetch autocomplete suggestions for: ${query}`, e);
    }
  }
  
  return Array.from(suggestions);
}

async function fetchTopSearchContext(query: string): Promise<string> {
  const queries = [
    query,
    `${query} guide tutorial`,
    `${query} troubleshooting issues`
  ];
  
  const results: string[] = [];
  const seenUrls = new Set<string>();
  let count = 0;
  
  for (const q of queries) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36'
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      
      const matches = html.matchAll(/<a class="result__url"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g);
      for (const match of matches) {
        if (count >= 10) break;
        const urlText = match[1].replace(/<[^>]*>/g, '').trim();
        if (seenUrls.has(urlText)) continue;
        seenUrls.add(urlText);
        
        const snippet = match[2].replace(/<[^>]*>/g, '').trim();
        results.push(`Top Post Reference ${count + 1}:\nSource URL: ${urlText}\nSnippet/Key Details: ${snippet}`);
        count++;
      }
    } catch (e) {
      console.error(`Failed to fetch snippets for search sub-query: ${q}`, e);
    }
  }
  
  return results.join('\n\n');
}

async function callLLM(
  provider: 'gemini' | 'openai',
  apiKeys: { gemini?: string; openai?: string },
  prompt: string,
  jsonMode: boolean = false,
  model?: string
): Promise<string> {
  if (provider === 'gemini') {
    const key = apiKeys.gemini;
    if (!key) throw new Error('Gemini API key is not configured.');
    
    const geminiModel = model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: jsonMode ? "application/json" : "text/plain"
        }
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }
    
    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('No content returned from Gemini API.');
    return content;
  } else {
    const key = apiKeys.openai;
    if (!key) throw new Error('OpenAI API key is not configured.');
    
    const openaiModel = model || 'gpt-4o-mini';
    const url = 'https://api.openai.com/v1/chat/completions';
    const isReasoning = openaiModel.startsWith('o1') || openaiModel.startsWith('o3');
    
    const requestBody: any = {
      model: openaiModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: jsonMode ? { type: "json_object" } : undefined
    };
    
    if (!isReasoning) {
      requestBody.temperature = 0.7;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }
    
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content returned from OpenAI API.');
    return content;
  }
}

// Background generation function to prevent gateway timeouts
async function runPipeline(
  runId: string,
  keyword: string,
  provider: 'gemini' | 'openai',
  selectedCategory: string,
  publishStatus: 'draft' | 'published',
  apiKeys: { gemini?: string; openai?: string },
  model?: string,
  author?: string
) {
  if (!adminDb) return;
  
  const runRef = adminDb.collection('auto_poster_runs').doc(runId);
  const logSteps: string[] = [];
  
  const updateLogs = async (msg: string) => {
    console.log(`[AutoPoster ${runId}] ${msg}`);
    logSteps.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    await runRef.update({ logs: logSteps });
  };

  try {
    // Step 1: Autocomplete Crawling
    await updateLogs(`Initiating autocomplete crawling for: "${keyword}"...`);
    const suggestions = await fetchGoogleSuggestions(keyword);
    await updateLogs(`Successfully crawled ${suggestions.length} trending search variations.`);
    
    if (suggestions.length === 0) {
      suggestions.push(keyword);
    }

    // Step 2: Intent Selection using AI
    await updateLogs(`Analyzing search intent and selecting primary article focus using ${provider === 'gemini' ? 'Gemini' : 'OpenAI'}...`);
    const intentPrompt = `You are an expert SEO strategist and editor.
Root Keyword: "${keyword}"
Google Autocomplete suggestions:
${JSON.stringify(suggestions, null, 2)}

Select the single most high-volume, problem-solving, and valuable long-tail search intent that matches what searchers are looking for. It should offer high educational/informational value.

Return a JSON object only. Do NOT add markdown code fences. Structure:
{
  "topic": "The exact title of the article (e.g. 'How to Fix XYZ Error')",
  "selectedKeyword": "The specific query chosen from the list",
  "intent": "Brief summary of reader intent",
  "unsplashQuery": "A 1-2 word query for Unsplash to find a relevant graphic/tech cover photo"
}`;

    const intentResponse = await callLLM(provider, apiKeys, intentPrompt, true, model);
    const parsedIntent = JSON.parse(cleanJsonString(intentResponse));
    await updateLogs(`Selected Topic: "${parsedIntent.topic}"`);
    await updateLogs(`Unsplash query keyword: "${parsedIntent.unsplashQuery}"`);

    // Step 2.5: Retrieve web search context of top ranking posts
    await updateLogs(`Searching web for top posts on: "${parsedIntent.topic}"...`);
    const searchContext = await fetchTopSearchContext(parsedIntent.topic);
    if (searchContext) {
      await updateLogs(`Successfully compiled real-time search context from top ranking reference pages.`);
    } else {
      await updateLogs(`Search queries returned no snippets, proceeding with base model training data.`);
    }

    // Step 3: Outline Architecture
    await updateLogs(`Architecting outline, meta tags, custom stylesheet, and FAQ schema...`);
    const outlinePrompt = `You are an expert content strategist, SEO specialist, and professional blog editor with 10+ years of experience writing for high-authority, AdSense-approved publications.
Your job is to generate a comprehensive, highly structured outline for a fully original, high-value, and deeply researched article that matches Google AdSense content quality standards and ranks exceptionally well in search engines.

Topic: "${parsedIntent.topic}"
Target Keyword: "${parsedIntent.selectedKeyword}"
Publishing Editor: "${author || 'AI Editor'}" (Frame the outline narrative, tone, and guidelines to match this author's area of expertise: Archit writes developer/code guides; Mahi writes SEO/marketing growth guides; Tiyasha writes workflows/productivity automation; Alisa writes SaaS reviews/comparisons).

${searchContext ? `Here are snippets from top ranking articles on this topic for factual research and context:\n${searchContext}\n\nAnalyze these references to build an outline that covers the topic in greater depth than any existing source.` : ''}

ARTICLE LENGTH & STRUCTURE GOALS:
- The final article will target 1,200–1,500 words in total.
- You must structure the outline with:
  1. An "Introduction" as the very first section in the \`sections\` array (100-150 words).
  2. 3 to 5 dynamic H2 body sections covering the core topic thoroughly.
  3. A "Conclusion" as the very last section in the \`sections\` array (100-150 words).
- All sections must have specific, detailed guidelines to ensure E-E-A-T alignment, actionable steps, real-world examples, and zero fluff.

Return a JSON object only. Do NOT add markdown code fences. Structure:
{
  "title": "Compelling, SEO-optimized title under 65 characters containing the target keyword",
  "excerpt": "A high-interest meta description (150-160 characters) optimized for CTR containing the target keyword",
  "slug": "SEO-optimized URL slug (e.g. 'how-to-fix-xyz')",
  "tags": ["tag1", "tag2", "tag3"],
  "targetAudience": "Brief profile of the target reader (e.g., beginners, professionals, small business owners)",
  "searchIntent": "Detailed explanation of the exact search intent and informational needs that this article must satisfy",
  "overallNarrative": "A cohesive overall narrative arc and flow of the piece",
  "customCss": "A custom CSS stylesheet string containing valid, highly polished, and modern CSS rules targeting .article-content child elements to make this specific article look premium, distinct, and visually stunning. Do NOT wrap in style tags. Create a cohesive color palette for this article using CSS variables defined in \`.article-content\` (e.g., --theme-primary, --theme-secondary, --theme-accent) depending on the topic (e.g. vibrant purples/blues for tech, deep emeralds for finance, warm terracotta/oranges for lifestyle/productivity). Use these variables to style custom classes and base elements. Style the following custom classes: \`.lead-paragraph\` (intro paragraphs with larger typography, elegant line height, or drop-caps using \`.drop-cap\`), \`.highlight\` (marker highlight spans), \`.badge\` (inline pills/tags), \`.custom-list\` and \`.custom-li\` (custom list bullet icons/counters). Style the premium container boxes: \`.highlight-box\`, \`.warning-box\`, \`.success-box\`, \`.tip-box\`, \`.checklist\`, \`.expert-note\`. Each box style must have distinct backgrounds, borders (e.g., left border accents), shadows, and padding. Also override standard elements to match the theme: style h2 (adding gradient underlines, left borders, or decorative tags), h3, blockquotes (with left border gradients, elegant spacing, italics, and soft box shadow), pre/code blocks (for vibrant modern dark syntax themes, adding a custom header or border), and table styles (using classes like \`.table-wrapper\` and \`.comparison-table\` for clean layout, themed header borders, row striping). Ensure all styles support dark mode by prefixing selectors with \`.dark\` (e.g., \`.dark .article-content .highlight-box\`).",
  "sections": [
    {
      "heading": "Introduction",
      "guidelines": "Hook the reader, state the problem/topic, and preview what they will learn. You MUST naturally place the target keyword '${parsedIntent.selectedKeyword}' in the first 100 words."
    },
    {
      "heading": "Section Heading (e.g., 'What Causes this Error?')",
      "guidelines": "Detailed guidelines covering the specific subtopic, technical code examples, lists, or comparison data."
    },
    {
      "heading": "Conclusion",
      "guidelines": "Summarize key takeaways, reinforce value, and end with a compelling Call-to-Action."
    }
  ],
  "faqs": [
    {
      "question": "Commonly asked question from 'People Also Ask'",
      "answer": "Direct, helpful answer under 50 words satisfying AdSense and SEO needs"
    }
  ]
}`;

    const outlineResponse = await callLLM(provider, apiKeys, outlinePrompt, true, model);
    const outline = JSON.parse(cleanJsonString(outlineResponse));
    await updateLogs(`Outline and custom stylesheet created successfully. Meta tags generated.`);

    // Step 4: Write Section Contents in Loop
    const generatedSections: string[] = [];
    let totalWordCount = 0;

    // We target a total article word count of ~1350 words (within the 1200-1500 word range)
    const targetSectionWords = Math.round(1350 / outline.sections.length);

    for (let i = 0; i < outline.sections.length; i++) {
      const section = outline.sections[i];
      await updateLogs(`Drafting section ${i + 1}/${outline.sections.length}: "${section.heading}"...`);
      
      const previousSectionContent = i > 0
        ? `--- PREVIOUS SECTION ("${outline.sections[i - 1].heading}") CONTENT ---\n${generatedSections[i - 1]}`
        : 'This is the first section of the article.';
        
      const nextSectionHeading = outline.sections[i + 1]
        ? `Next Section Heading: "${outline.sections[i + 1].heading}"`
        : 'This is the final section of the article.';

      let authorPersona = 'You are an award-winning technology journalist, senior software engineer, and technical editor.';
      if (author === 'Archit') {
        authorPersona = 'You are Archit, a senior software engineer, Lead Fullstack Architect, and founder of Mershal. Write in an authoritative, highly technical, and engineering-focused voice. Use precise technical terminology, provide clear code snippets or terminal commands where relevant, and focus on system architecture, code execution, and performance optimization. Speak from the perspective of a builder who has set up and debugged these configurations first-hand.';
      } else if (author === 'Mahi') {
        authorPersona = 'You are Mahi, a Senior SEO Strategist and Content Lead at Mershal. Write in an insightful, marketing-focused, and strategic voice. Focus on organic growth, search visibility, user acquisition, click-through rates (CTR), content architectures, and search engine optimization. Speak from the perspective of a growth marketer who designs campaigns and optimizes on-page layouts for real-world visibility.';
      } else if (author === 'Tiyasha') {
        authorPersona = 'You are Tiyasha, a Digital Productivity and UX Analyst at Mershal. Write in a clear, workflow-centric, and analytical voice. Focus on workplace efficiency, SaaS automation workflows, remote work tooling integrations, user experience, and productivity hacks. Speak from the perspective of an operations specialist who reviews pipelines and eliminates friction from daily work routines.';
      } else if (author === 'Alisa') {
        authorPersona = 'You are Alisa, a SaaS Product Analyst at Mershal. Write in a critical, feature-focused, and comparative voice. Focus on software value propositions, pricing tiers, key integrations, feature usability scoring, and direct alternatives comparison. Speak from the perspective of an analyst who tests SaaS platforms rigorously and writes honest, detailed, and data-backed feature reviews.';
      }

      const writePrompt = `${authorPersona}

You are an expert content strategist, SEO specialist, and professional blog writer with 10+ years of experience writing for high-authority publications. Your job is to write a fully original, deeply researched, high-value section of a comprehensive article that meets Google AdSense content quality standards and ranks well in search engines.

--- ARTICLE METADATA ---
Article Title: "${outline.title}"
Target Keyword: "${parsedIntent.selectedKeyword}"
Target Audience: "${outline.targetAudience || 'General readers'}"
Search Intent: "${outline.searchIntent || 'Informational and educational'}"
Overall Narrative Arc: "${outline.overallNarrative || 'Helpful guide'}"
Full Article Outline:
${outline.sections.map((s: any, idx: number) => `${idx + 1}. ${s.heading} (${s.guidelines})`).join('\n')}

--- CONTEXT CONTINUITY ---
${previousSectionContent}

CURRENT SECTION TO WRITE:
Section Heading: "${section.heading}"
Section Guidelines: "${section.guidelines}"

${nextSectionHeading}

${searchContext ? `Here are snippets from top ranking articles on this topic for factual research and context:\n${searchContext}\n\nUse this real-world context and facts to ensure the content is highly researched, accurate, and professional.` : ''}

Strict content guidelines to follow:
1. ACCESSIBILITY & SIMPLICITY: Use simple words and clear, concise sentences. Avoid overly complex technical jargon, pretentious vocabulary, or convoluted grammar. Explain concepts clearly using simple analogies or relatable, real-world examples so that everyone can understand and relate to the article. Never use complex words when a simple one works better (e.g., use "use" instead of "utilize", "begin" instead of "commence", "show" instead of "demonstrate").
2. ADSense POLICY & QUALITY: No thin or low-effort content — every single paragraph must add genuine, specific value. Do not write generic or filler text. Maintain a naturally balanced, helpful, human-first perspective. Avoid AI-sounding clichés ("in today's fast-paced world," "unlock the power of," "delve into," "in summary," "essentially," "moreover," "furthermore").
3. SCANNABLE PARAGRAPHS: Keep paragraphs short and highly scannable (2-4 sentences max, averaging 40 to 90 words). Use bullet points, numbered lists, or styled layout containers where appropriate to break up large blocks of text.
4. KEYWORD PLACEMENT:
   - If this section is the "Introduction", you MUST naturally place the target keyword "${parsedIntent.selectedKeyword}" within the first 100 words.
   - For all other sections, write naturally and avoid keyword stuffing.
5. INTERNAL & EXTERNAL LINKS:
   - Naturally suggest 2-3 internal link anchors in the format: \`[link to related article on X]\`.
   - Naturally suggest 1-2 authoritative external reference anchors in the format: \`[link to authoritative reference on Y]\`.
6. DESIGN SYSTEM INTEGRATION: Think like a designer. Every 300 to 500 words, include exactly one visual element or styled box where it naturally improves understanding. Do NOT over-use them. Use the following CSS/HTML design system classes:
   - For introductory paragraphs or key opening thoughts, use: <p class="lead-paragraph">...</p> or insert a drop cap: <span class="drop-cap">T</span>he rest of the text...
   - Highlight box: <div class="highlight-box">...</div>
   - Warning box: <div class="warning-box">...</div>
   - Success box: <div class="success-box">...</div>
   - Tip box: <div class="tip-box">...</div>
   - Checklist: <ul class="checklist"><li>[ ] ...</li></ul>
   - Expert note: <div class="expert-note">...</div>
   - Quotes: <blockquote>...</blockquote>
   - Comparison tables: Wrap tables in <div class="table-wrapper"><table class="comparison-table">...</table></div>
   - Highlighted text segments: <span class="highlight">...</span>
   - Badges/inline pills: <span class="badge">...</span>
7. FORMATTING: Use HTML tags ONLY: <p>, <strong>, <em>, <ul>, <ol>, <li>, <blockquote>, <pre><code>, <h3>, <h4>, <div>, <span>, <table>, <thead>, <tbody>, <tr>, <th>, <td>. Do NOT include markdown code fences (\`\`\`html) or outer wrapper tags (<html>/<body>).
8. LENGTH: Write approximately ${targetSectionWords} words for this section (aim for a strict range of ${targetSectionWords - 30} to ${targetSectionWords + 30} words).
9. NO DUPLICATE HEADINGS: Do NOT output the section heading ("${section.heading}") inside your response. Start writing directly with the section's content (paragraphs, lists, boxes, etc.).`;

      const sectionHtml = await callLLM(provider, apiKeys, writePrompt, false, model);
      const cleanedSectionHtml = cleanSectionOutput(sectionHtml, section.heading);
      generatedSections.push(`<h2>${section.heading}</h2>\n${cleanedSectionHtml}`);
      
      const wordCount = countWords(cleanedSectionHtml.replace(/<[^>]*>/g, ''));
      totalWordCount += wordCount;
      await updateLogs(`Completed section ${i + 1} (${wordCount} words drafted).`);
    }

    const fullContent = generatedSections.join('\n\n');
    const finalWordCount = countWords(fullContent.replace(/<[^>]*>/g, ''));
    const readingTime = Math.ceil(finalWordCount / 200);
    await updateLogs(`Drafting complete! Total article size: ${finalWordCount} words.`);

    // Step 5: Manual Cover Image Setup
    await updateLogs(`Skipping cover image lookup. Thumbnail will be uploaded manually by Editor.`);
    let featuredImage = '';

    // Step 6: Save Article to Firestore
    await updateLogs(`Saving article to database...`);
    const articleDoc = {
      title: outline.title,
      slug: outline.slug,
      excerpt: outline.excerpt || '',
      content: fullContent,
      category: selectedCategory,
      tags: outline.tags || [],
      featured_image: featuredImage,
      author: author || 'AI Editor',
      status: publishStatus,
      meta_title: outline.title,
      meta_description: outline.excerpt || '',
      wordCount: finalWordCount,
      readingTime,
      publish_date: new Date(),
      updated_date: new Date(),
      faq_items: outline.faqs || [],
      isCustomHtml: false,
      customCss: outline.customCss || ''
    };

    const articleRef = await adminDb.collection('articles').add(articleDoc);
    await updateLogs(`Article created successfully with ID: ${articleRef.id}`);

    // Step 7: Auto Google Indexing if Published
    if (publishStatus === 'published') {
      try {
        await updateLogs(`Triggering Google Indexing API submission...`);
        const siteUrl = await getSiteUrl();
        const catSlug = selectedCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const postUrl = `${siteUrl}/${catSlug}/${outline.slug}`;
        
        await updateLogs(`Submitting URL to Google API: ${postUrl}`);
        const result = await submitToGoogleIndexing(postUrl, 'URL_UPDATED');
        
        await adminDb.collection('indexing_logs').add({
          url: postUrl,
          action: 'publish',
          timestamp: new Date().toISOString(),
          status: 'success',
          response: JSON.stringify(result)
        });
        await updateLogs(`Google Indexing notification completed successfully!`);
      } catch (indexingErr: any) {
        console.error('Auto indexing failed:', indexingErr);
        await updateLogs(`Warning: Google indexing API failed: ${indexingErr.message || 'Check credentials'}`);
      }
    }

    await runRef.update({
      status: 'success',
      articleId: articleRef.id,
      articleTitle: outline.title,
      articleSlug: outline.slug,
      category: selectedCategory,
      wordCount: finalWordCount,
      completedAt: new Date().toISOString()
    });
    await updateLogs(`AI Auto-posting pipeline successfully completed.`);

  } catch (error: any) {
    console.error('Error during auto-posting generation:', error);
    logSteps.push(`[${new Date().toLocaleTimeString()}] FATAL ERROR: ${error.message || 'Pipeline failed'}`);
    await runRef.update({
      status: 'failed',
      error: error.message || 'Unknown generation error',
      logs: logSteps,
      completedAt: new Date().toISOString()
    });
  }
}

export const GET: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  const url = new URL(request.url);
  const runId = url.searchParams.get('runId');

  try {
    if (runId) {
      const runDoc = await adminDb.collection('auto_poster_runs').doc(runId).get();
      if (!runDoc.exists) {
        return new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 });
      }
      return new Response(JSON.stringify(runDoc.data()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch all logs
    const snapshot = await adminDb
      .collection('auto_poster_runs')
      .orderBy('timestamp', 'desc')
      .limit(30)
      .get();

    const runs = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        keyword: d.keyword || '',
        provider: d.provider || 'gemini',
        model: d.model || '',
        status: d.status || 'running',
        timestamp: d.timestamp || '',
        articleTitle: d.articleTitle || '',
        articleSlug: d.articleSlug || '',
        category: d.category || '',
        wordCount: d.wordCount || 0,
        error: d.error || ''
      };
    });

    return new Response(JSON.stringify(runs), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const { keyword, category, status, provider, model, author } = await request.json();

    if (!keyword || !keyword.trim()) {
      return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });
    }

    const providerVal = provider || 'gemini';
    const categoryVal = category || 'AI Tools';
    const statusVal = status === 'published' ? 'published' : 'draft';
    const authorVal = author || 'AI Editor';

    // Retrieve settings for API Keys
    const settingsDoc = await adminDb.collection('settings').doc('general').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    
    const geminiApiKey = settings?.geminiApiKey || process.env.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
    const openaiApiKey = settings?.openaiApiKey || process.env.OPENAI_API_KEY || import.meta.env.OPENAI_API_KEY;

    if (providerVal === 'gemini' && !geminiApiKey) {
      return new Response(JSON.stringify({ error: 'Gemini API Key is not configured. Add it in Settings.' }), { status: 400 });
    }
    if (providerVal === 'openai' && !openaiApiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI API Key is not configured. Add it in Settings.' }), { status: 400 });
    }

    // Save initial run doc
    const runDoc = {
      keyword: keyword.trim(),
      provider: providerVal,
      model: model || '',
      category: categoryVal,
      status: 'running',
      logs: [`[${new Date().toLocaleTimeString()}] Spawning background workers...`],
      timestamp: new Date().toISOString()
    };

    const runRef = await adminDb.collection('auto_poster_runs').add(runDoc);

    // Fire background process (no await)
    runPipeline(
      runRef.id,
      keyword.trim(),
      providerVal,
      categoryVal,
      statusVal,
      { gemini: geminiApiKey, openai: openaiApiKey },
      model,
      authorVal
    );

    return new Response(JSON.stringify({ success: true, runId: runRef.id }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Failed to initialize auto-poster request:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
