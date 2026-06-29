import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';
import { submitToGoogleIndexing } from '../../../lib/google-api';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

function cleanJsonString(str: string): string {
  return str
    .replace(/^```json\s*/i, '')
    .replace(/```$/, '')
    .trim();
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
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return '';
    const html = await res.text();
    
    // Parse DuckDuckGo search results
    const matches = html.matchAll(/<a class="result__url"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g);
    const results: string[] = [];
    let count = 0;
    
    for (const match of matches) {
      if (count >= 5) break;
      const urlText = match[1].replace(/<[^>]*>/g, '').trim();
      const snippet = match[2].replace(/<[^>]*>/g, '').trim();
      results.push(`Top Article ${count + 1}:\nSource: ${urlText}\nSnippet Summary: ${snippet}`);
      count++;
    }
    
    if (results.length === 0) {
      // Fallback regex matching result__snippet
      const snippets = html.matchAll(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g);
      for (const match of snippets) {
        if (count >= 5) break;
        results.push(`Snippet Reference ${count + 1}: ${match[1].replace(/<[^>]*>/g, '').trim()}`);
        count++;
      }
    }
    
    return results.join('\n\n');
  } catch (e) {
    console.error('Failed to fetch search context:', e);
    return '';
  }
}

async function callLLM(
  provider: 'gemini' | 'openai',
  apiKeys: { gemini?: string; openai?: string },
  prompt: string,
  jsonMode: boolean = false
): Promise<string> {
  if (provider === 'gemini') {
    const key = apiKeys.gemini;
    if (!key) throw new Error('Gemini API key is not configured.');
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
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
    
    const url = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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
  apiKeys: { gemini?: string; openai?: string }
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

    const intentResponse = await callLLM(provider, apiKeys, intentPrompt, true);
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

The outline must define 4 to 6 logical H2/H3 sections. The sections must flow logically, providing real details, actionable steps, and code examples if appropriate.

Return a JSON object only. Do NOT add markdown code fences. Structure:
{
  "title": "Compelling, catchy final article title (under 60 chars)",
  "excerpt": "A high-interest 2-sentence intro summary (under 160 chars)",
  "slug": "SEO-optimized URL slug (e.g. 'how-to-fix-xyz')",
  "tags": ["tag1", "tag2", "tag3"],
  "customCss": "A custom CSS stylesheet string containing valid, highly polished, and modern CSS rules targeting .article-content child elements to make this specific article look premium, distinct, and visually stunning. Do NOT wrap in style tags. Create a cohesive color palette for this article using CSS variables defined in \`.article-content\` (e.g., --theme-primary, --theme-secondary, --theme-accent) depending on the topic (e.g. vibrant purples/blues for tech, deep emeralds for finance, warm terracotta/oranges for lifestyle/productivity). Use these variables to style custom classes and base elements. Style the following custom classes: \`.lead-paragraph\` (for the intro with larger typography, elegant line height, or drop-caps using \`.drop-cap\`), \`.custom-callout\` (with borders, border-radius, background gradients, padding, shadows, and left borders color-coded for callout types: \`.warning\`, \`.info\`, \`.success\`), \`.highlight\` (for marker highlight spans), \`.badge\` (for inline pills/tags), \`.custom-list\` and \`.custom-li\` (for custom list bullet icons/counters). Also override standard elements to match the theme: style h2 (adding gradient underlines, left borders, or decorative tags), h3, blockquotes (with left border gradients, elegant spacing, italics, and soft box shadow), pre/code blocks (for vibrant modern dark syntax themes, adding a custom header or border), and table styles (clean layout, themed header borders, row striping). Ensure all styles support dark mode by prefixing selectors with \`.dark\` (e.g., \`.dark .article-content .custom-callout\`).",
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

    const outlineResponse = await callLLM(provider, apiKeys, outlinePrompt, true);
    const outline = JSON.parse(cleanJsonString(outlineResponse));
    await updateLogs(`Outline and custom stylesheet created successfully. Meta tags generated.`);

    // Step 4: Write Section Contents in Loop
    const generatedSections: string[] = [];
    let totalWordCount = 0;

    for (let i = 0; i < outline.sections.length; i++) {
      const section = outline.sections[i];
      await updateLogs(`Drafting section ${i + 1}/${outline.sections.length}: "${section.heading}"...`);
      
      const writePrompt = `You are an expert technical writer and subject matter expert. Write a highly detailed, comprehensive section for the article: "${outline.title}".
Section Heading: "${section.heading}"
Section Guidelines: "${section.guidelines}"

${searchContext ? `Here are snippets from top ranking articles on this topic for factual research and context:\n${searchContext}\n\nUse this real-world context and facts to ensure the content is highly researched, accurate, and professional.` : ''}

Requirements for a professional, well-researched, and AdSense-friendly article:
1. DEEP RESEARCH & DETAIL: Provide thorough explanations of concepts, configurations, and best practices. Avoid generic summaries or high-level generalizations.
2. ACTIONABLE EXAMPLES: Provide complete, clean, and commented code blocks inside <pre><code>...</code></pre> tags if applicable. Use modern conventions.
3. PREMIUM LAYOUTS & CSS CLASSES: To match the dedicated Custom CSS generated for this article, you must format the HTML content to use custom styling classes:
   - For opening thoughts, summaries, or introductory paragraphs in a section: use a lead paragraph like \`<p class="lead-paragraph">...</p>\` or insert a drop cap \`<span class="drop-cap">T</span>he rest of the text...\`.
   - For tips, warnings, suggestions, or highlights: wrap them in a callout container, e.g., \`<div class="custom-callout info"><strong>Pro Tip:</strong> ...</div>\`, \`<div class="custom-callout warning"><strong>Caution:</strong> ...</div>\`, or \`<div class="custom-callout success"><strong>Important Note:</strong> ...</div>\`.
   - For badge-like inline elements, use \`<span class="badge">text</span>\`.
   - For highlighted text segments, use \`<span class="highlight">highlighted text</span>\`.
   - For structured, modern tables, include proper headers and striped rows.
   - For lists, use custom lists \`<ul class="custom-list">\` or standard bullets styled with \`custom-li\` classes where appropriate.
4. ON-PAGE SEO: Naturally weave in keywords and relevant sub-terms. Use formatting like bullet points, bold key terms, blockquotes, and tables where appropriate to improve readability.
5. ARTICLE INTERLINKING: Naturally weave in exact phrases for major categories/topics (e.g., "Web Development", "AI Tools", "Productivity", "SEO", "Freelancing", "Remote Work", "Startup Stories") in body sentences to enable contextual interlinking.
6. FORMATTING: Use HTML tags ONLY: <p>, <strong>, <em>, <ul>, <ol>, <li>, <blockquote>, <pre><code>, <h3>, <div>, <span>, <table>, <thead>, <tbody>, <tr>, <th>, <td> etc. Do NOT include markdown code fences (\`\`\`html) or outer wrapper tags (<html>/<body>).
7. LENGTH: Write 400 to 600 words for this section alone. Maintain an expert, authoritative, and helpful human tone.`;

      const sectionHtml = await callLLM(provider, apiKeys, writePrompt, false);
      const cleanedSectionHtml = sectionHtml.replace(/^```html\s*/i, '').replace(/```$/, '').trim();
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
            featuredImage = unsplashData.results[randomIndex].urls.regular;
            await updateLogs(`Selected high-resolution Unsplash photo.`);
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
    const { keyword, category, status, provider } = await request.json();

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
      { gemini: geminiApiKey, openai: openaiApiKey }
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
