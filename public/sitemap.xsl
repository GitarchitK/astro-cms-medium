<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
  xmlns:html="http://www.w3.org/TR/REC-html40"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <title>XML Sitemap — Mershal</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&amp;family=Plus+Jakarta+Sans:wght@400;500;600;700&amp;display=swap" rel="stylesheet" />
        <style type="text/css">
          body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            color: #334155;
            background-color: #f8fafc;
            margin: 0;
            padding: 40px 16px;
          }
          .container {
            max-width: 960px;
            margin: 0 auto;
            background: #ffffff;
            padding: 36px;
            border-radius: 24px;
            box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02);
            border: 1px solid #f1f5f9;
          }
          .header {
            margin-bottom: 28px;
            border-bottom: 1px solid #f1f5f9;
            padding-bottom: 24px;
          }
          h1 {
            font-family: 'Outfit', sans-serif;
            font-size: 28px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 8px 0;
            letter-spacing: -0.02em;
          }
          p.subtitle {
            color: #64748b;
            font-size: 14px;
            margin: 0;
            line-height: 1.6;
            font-weight: 500;
          }
          p.subtitle a {
            color: #4f46e5;
            text-decoration: none;
            font-weight: 700;
          }
          p.subtitle a:hover {
            text-decoration: underline;
          }
          .stats {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background-color: #f5f3ff;
            border-radius: 9999px;
            font-weight: 700;
            color: #4f46e5;
            font-size: 12px;
            margin-bottom: 12px;
          }
          .stats-value {
            color: #4338ca;
            background: #e0e7ff;
            padding: 2px 8px;
            border-radius: 9999px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            margin-top: 16px;
          }
          th {
            background-color: #f8fafc;
            color: #475569;
            font-weight: 700;
            padding: 12px 16px;
            border-bottom: 2px solid #e2e8f0;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.08em;
          }
          tr {
            transition: background-color 0.15s ease;
          }
          tr:hover td {
            background-color: #faf5ff;
          }
          td {
            padding: 14px 16px;
            border-bottom: 1px solid #f1f5f9;
            word-break: break-all;
          }
          a.loc-link {
            color: #312e81;
            text-decoration: none;
            font-weight: 600;
            font-size: 13.5px;
            transition: color 0.15s ease;
          }
          a.loc-link:hover {
            color: #4f46e5;
          }
          .priority-badge {
            display: inline-flex;
            padding: 2px 8px;
            border-radius: 9999px;
            font-size: 11px;
            font-weight: 800;
            background-color: #e0e7ff;
            color: #4338ca;
          }
          .priority-badge.high {
            background-color: #e0e7ff;
            color: #4338ca;
          }
          .priority-badge.med {
            background-color: #f0fdf4;
            color: #166534;
          }
          .priority-badge.low {
            background-color: #f8fafc;
            color: #64748b;
          }
          .freq-badge {
            text-transform: capitalize;
            color: #475569;
            font-size: 12px;
            font-weight: 600;
          }
          .date {
            color: #64748b;
            font-size: 12.5px;
            font-family: monospace;
            font-weight: 500;
          }
          .footer {
            margin-top: 32px;
            text-align: center;
            font-size: 11px;
            color: #94a3b8;
            font-weight: 500;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="stats">
              Total Indexed URLs: <span class="stats-value"><xsl:value-of select="count(sitemap:urlset/sitemap:url)"/></span>
            </div>
            <h1>XML Sitemap Index</h1>
            <p class="subtitle">
              This is a professionally optimized XML Sitemap generated dynamically by <a href="/">Mershal</a>. 
              Search engines use it to index and retrieve articles, guides, and categories quickly. 
              You can also view the human-friendly version of our sitemap <a href="/sitemap">here</a>.
            </p>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 50%;">URL Location</th>
                <th style="width: 18%; text-align: center;">Priority</th>
                <th style="width: 16%;">Change Freq</th>
                <th style="width: 16%;">Last Modified</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sitemap:urlset/sitemap:url">
                <xsl:sort select="sitemap:priority" data-type="number" order="descending"/>
                <tr>
                  <td>
                    <xsl:variable name="itemURL">
                      <xsl:value-of select="sitemap:loc"/>
                    </xsl:variable>
                    <a href="{$itemURL}" class="loc-link">
                      <xsl:value-of select="sitemap:loc"/>
                    </a>
                  </td>
                  <td style="text-align: center;">
                    <xsl:variable name="pVal">
                      <xsl:value-of select="sitemap:priority"/>
                    </xsl:variable>
                    <xsl:choose>
                      <xsl:when test="$pVal &gt;= 0.8">
                        <span class="priority-badge high"><xsl:value-of select="sitemap:priority"/></span>
                      </xsl:when>
                      <xsl:when test="$pVal &gt;= 0.5">
                        <span class="priority-badge med"><xsl:value-of select="sitemap:priority"/></span>
                      </xsl:when>
                      <xsl:otherwise>
                        <span class="priority-badge low"><xsl:value-of select="sitemap:priority"/></span>
                      </xsl:otherwise>
                    </xsl:choose>
                  </td>
                  <td class="freq-badge">
                    <xsl:value-of select="sitemap:changefreq"/>
                  </td>
                  <td class="date">
                    <xsl:value-of select="substring(sitemap:lastmod, 0, 11)"/>&#160;<xsl:value-of select="substring(sitemap:lastmod, 12, 5)"/>
                  </td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
          <div class="footer">
            Generated by Mershal. Built with Astro &amp; Firebase.
          </div>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
