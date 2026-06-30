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
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        response_format: jsonMode ? { type: "json_object" } : undefined
      })
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
  model?: string
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
    const outlinePrompt = `You are an expert technical editor and SEO strategist. Generate a comprehensive outline for an authoritative, in-depth, and AdSense-friendly article.
Topic: "${parsedIntent.topic}"
Target Keyword: "${parsedIntent.selectedKeyword}"

${searchContext ? `Here are snippets from top ranking articles on this topic for research and reference:\n${searchContext}\n\nAnalyze these top posts to build an outline that is even more complete, comprehensive, and helpful.` : ''}

DYNAMIC ARTICLE STRUCTURE: The outline must define a logical set of H2/H3 sections. The number of sections must be determined dynamically based on the complexity of the topic and research context (minimum 3 sections, maximum 5 sections). Do NOT use a standard outline or a fixed number of sections. Every article must have a unique outline structure and a different number of sections that matches what is actually needed to solve the specific problem.

Return a JSON object only. Do NOT add markdown code fences. Structure:
{
  "title": "Compelling, catchy final article title (under 60 chars)",
  "excerpt": "A high-interest 2-sentence intro summary (under 160 chars)",
  "slug": "SEO-optimized URL slug (e.g. 'how-to-fix-xyz')",
  "tags": ["tag1", "tag2", "tag3"],
  "targetAudience": "Brief profile of the target reader (e.g., frontend developer, system admin, beginner designer)",
  "searchIntent": "Detailed explanation of the exact search intent and information needs that this article must satisfy",
  "overallNarrative": "A cohesive overall narrative arc and flow of the piece (e.g., start with problem description, analyze root cause, present a comparison of options, step-by-step resolution, key takeaways)",
  "customCss": "A custom CSS stylesheet string containing valid, highly polished, and modern CSS rules targeting .article-content child elements to make this specific article look premium, distinct, and visually stunning. Do NOT wrap in style tags. Create a cohesive color palette for this article using CSS variables defined in \`.article-content\` (e.g., --theme-primary, --theme-secondary, --theme-accent) depending on the topic (e.g. vibrant purples/blues for tech, deep emeralds for finance, warm terracotta/oranges for lifestyle/productivity). Use these variables to style custom classes and base elements. Style the following custom classes: \`.lead-paragraph\` (intro paragraphs with larger typography, elegant line height, or drop-caps using \`.drop-cap\`), \`.highlight\` (marker highlight spans), \`.badge\` (inline pills/tags), \`.custom-list\` and \`.custom-li\` (custom list bullet icons/counters). Style the premium container boxes: \`.highlight-box\`, \`.warning-box\`, \`.success-box\`, \`.tip-box\`, \`.checklist\`, \`.expert-note\`. Each box style must have distinct backgrounds, borders (e.g., left border accents), shadows, and padding. Also override standard elements to match the theme: style h2 (adding gradient underlines, left borders, or decorative tags), h3, blockquotes (with left border gradients, elegant spacing, italics, and soft box shadow), pre/code blocks (for vibrant modern dark syntax themes, adding a custom header or border), and table styles (using classes like \`.table-wrapper\` and \`.comparison-table\` for clean layout, themed header borders, row striping). Ensure all styles support dark mode by prefixing selectors with \`.dark\` (e.g., \`.dark .article-content .highlight-box\`).",
  "sections": [
    {
      "heading": "Heading title (e.g., 'What Causes this Error?')",
      "guidelines": "Instructions detailing what must be fully explained in this section. Ask to write code, provide terminal commands, etc."
    }
  ],
  "faqs": [
    {
      "question": "Commonly asked question",
      "answer": "Direct, helpful answer under 50 words"
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

      const writePrompt = `You are an award-winning technology journalist, senior software engineer, university researcher, technical editor, UX writer, and long-form feature writer. Your work is comparable in quality to publications such as Ars Technica, Stripe Docs, Vercel Blog, GitHub Engineering, Cloudflare Blog, and Linear.

Write a highly detailed, authoritative, and engaging section of a comprehensive article.

--- ARTICLE METADATA ---
Article Title: "${outline.title}"
Target Audience: "${outline.targetAudience || 'General developers and tech professionals'}"
Search Intent: "${outline.searchIntent || 'Informational and educational walkthrough'}"
Overall Narrative Arc: "${outline.overallNarrative || 'Informative engineering guide'}"
Full Article Outline:
${outline.sections.map((s: any, idx: number) => `${idx + 1}. ${s.heading} (${s.guidelines})`).join('\n')}

--- CONTEXT CONTINUITY ---
${previousSectionContent}

CURRENT SECTION TO WRITE:
Section Heading: "${section.heading}"
Section Guidelines: "${section.guidelines}"

${nextSectionHeading}

${searchContext ? `Here are snippets from top ranking articles on this topic for factual research and context:\n${searchContext}\n\nUse this real-world context and facts to ensure the content is highly researched, accurate, and professional.` : ''}

Strict instructions to ensure this article reads like a premium, professionally edited, and publication-ready piece:
1. PREMIUM EDITORIAL VOICE: Write in an authoritative, clear, and engaging professional voice. Only use first-person experiences ("I", "we", "in my experiments") when they genuinely improve credibility and fit a real scenario (e.g., debugging a specific error or testing a feature). Do not force first-person pronouns into every sentence.
2. EDITORIAL STANDARDS: Every sentence must earn its place. Do NOT explain obvious, basic definitions (e.g., do not explain what a database is or what an error means unless it's the core focus of the topic). Never repeat ideas, phrases, or keywords across or within paragraphs. Every paragraph must introduce a new, valuable insight. Avoid textbook writing and SEO keyword stuffing.
3. READABILITY RHYTHM & PARAGRAPHS: Average paragraph length should be 40 to 90 words. Never exceed 120 words for a paragraph unless absolutely necessary. Alternate between short punchy paragraphs, medium paragraphs, and longer explanatory paragraphs to create a natural human reading flow.
4. NARRATIVE STORYTELLING: Whenever possible, start the section or sub-points with a brief real-world observation, a common developer misconception, a concrete problem, a surprising statistic, or a short scenario, rather than a generic textbook explanation.
5. VISUAL LAYOUT & DESIGN SYSTEM: Think like a designer. Every 300 to 500 words, include exactly one visual element or styled box where it naturally improves understanding. Do NOT over-use them. Use the following CSS/HTML design system classes:
   - For introductory paragraphs or key opening thoughts, use: <p class="lead-paragraph">...</p> or insert a drop cap: <span class="drop-cap">T</span>he rest of the text...
   - Highlight box: <div class="highlight-box">...</div> (for key callouts)
   - Warning box: <div class="warning-box">...</div> (for errors, pitfalls, cautions)
   - Success box: <div class="success-box">...</div> (for verified solutions, positive results)
   - Tip box: <div class="tip-box">...</div> (for pro-tips, helper advice)
   - Checklist: <ul class="checklist"><li>[ ] ...</li></ul>
   - Expert note: <div class="expert-note">...</div>
   - Quotes: <blockquote>...</blockquote>
   - Comparison tables: Wrap tables in <div class="table-wrapper"><table class="comparison-table">...</table></div>
   - Highlighted text segments: <span class="highlight">...</span>
   - Badges/inline pills: <span class="badge">...</span>
6. STRONGER TRANSITIONS: Ensure this section naturally connects to the previous section. Use the provided previous section's text to write a smooth opening transition, and use the next section's heading to bridge or direct the reader forward at the end.
7. ON-PAGE SEO & INTENT: Do NOT optimize for keywords. Optimize for search intent. Write exactly what would completely satisfy the reader if they searched this query.
8. FORMATTING: Use HTML tags ONLY: <p>, <strong>, <em>, <ul>, <ol>, <li>, <blockquote>, <pre><code>, <h3>, <h4>, <div>, <span>, <table>, <thead>, <tbody>, <tr>, <th>, <td> etc. Do NOT include markdown code fences (\`\`\`html) or outer wrapper tags (<html>/<body>).
9. LENGTH: Write approximately ${targetSectionWords} words for this section (aim for a strict range of ${targetSectionWords - 30} to ${targetSectionWords + 30} words). Maintain an expert, authoritative, and helpful human tone.
10. NO DUPLICATE HEADINGS: Do NOT output the section heading ("${section.heading}") inside your response. Start writing directly with the section's content (paragraphs, divs, lists, etc.). The heading will be rendered automatically by the system.`;

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

    // Step 5: Unsplash Cover Image lookup
    await updateLogs(`Querying Unsplash API for cover image keyword: "${parsedIntent.unsplashQuery}"...`);
    let featuredImage = 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?q=80&w=1200&auto=format&fit=crop';
    const unsplashAccessKey = process.env.UNSPLASH_ACCESS_KEY || import.meta.env.UNSPLASH_ACCESS_KEY;
    
    if (unsplashAccessKey) {
      try {
        const queryTerm = parsedIntent.unsplashQuery || keyword;
        const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(queryTerm)}&client_id=${unsplashAccessKey}&per_page=5`;
        const unsplashRes = await fetch(unsplashUrl);
        if (unsplashRes.ok) {
          const unsplashData = await unsplashRes.json();
          if (unsplashData.results && unsplashData.results.length > 0) {
            const randomIndex = Math.floor(Math.random() * Math.min(5, unsplashData.results.length));
            const unsplashImgUrl = unsplashData.results[randomIndex].urls.regular;
            await updateLogs(`Selected Unsplash photo: ${unsplashImgUrl}. Uploading to Cloudinary...`);
            
            try {
              const imgRes = await fetch(unsplashImgUrl);
              if (imgRes.ok) {
                const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                
                const uploadRes = await new Promise<any>((resolve, reject) => {
                  const uploadStream = cloudinary.uploader.upload_stream(
                    {
                      folder: 'articles',
                      use_filename: true,
                      unique_filename: true,
                    },
                    (error, result) => {
                      if (error) reject(error);
                      else resolve(result);
                    }
                  );
                  uploadStream.end(imgBuffer);
                });
                
                featuredImage = uploadRes.secure_url;
                await updateLogs(`Successfully uploaded cover photo to Cloudinary: ${featuredImage}`);
              } else {
                featuredImage = unsplashImgUrl;
                await updateLogs(`Unsplash image fetch failed (status: ${imgRes.status}), fallback to direct hotlink.`);
              }
            } catch (err: any) {
              featuredImage = unsplashImgUrl;
              await updateLogs(`Cloudinary upload failed: ${err.message || err}, fallback to direct Unsplash hotlink.`);
            }
          }
        }
      } catch (e) {
        console.error('Failed to query Unsplash:', e);
        await updateLogs('Unsplash search failed, using default tech banner.');
      }
    } else {
      await updateLogs('Unsplash API key not set, using default tech banner.');
    }

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
      author: 'AI Editor',
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
    const { keyword, category, status, provider, model } = await request.json();

    if (!keyword || !keyword.trim()) {
      return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });
    }

    const providerVal = provider || 'gemini';
    const categoryVal = category || 'AI Tools';
    const statusVal = status === 'published' ? 'published' : 'draft';

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
      model
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
