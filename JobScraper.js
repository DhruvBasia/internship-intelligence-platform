/**
 * JobScraper.js
 * Pulls jobs from SimplifyJobs listings (JSON), RSS feeds, and 
 * handles custom website text extraction.
 */

/**
 * Main function called to run aggregation.
 * Filters for AI/ML/Data Science jobs from multiple sources.
 */
function aggregateJobs() {
  var userProfile = dbGetUserProfile();
  var targetRoles = userProfile.target_roles || "Machine Learning, Data Science, AI, Deep Learning, Computer Vision, NLP, ML";
  var keywords = targetRoles.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (keywords.length === 0 || keywords[0] === "") {
    keywords = ["machine learning", "ml", "data scientist", "data science", "nlp", "computer vision", "deep learning", "ai"];
  }
  
  var discoveredJobs = [];
  
  // 1. Scraping SimplifyJobs JSON (Summer 2026/2025)
  try {
    var simplifyJobs = scrapeSimplifyJobsJson(keywords);
    discoveredJobs = discoveredJobs.concat(simplifyJobs);
    console.log("Discovered " + simplifyJobs.length + " matching jobs from SimplifyJobs JSON");
  } catch (e) {
    console.error("Error scraping SimplifyJobs: " + e.message);
  }
  
  // 2. Scraping AI-Jobs.net RSS Feed (100% pure AI/ML roles)
  try {
    var aiJobs = scrapeRssFeed("https://ai-jobs.net/feed/", keywords, "AI-Jobs.net");
    discoveredJobs = discoveredJobs.concat(aiJobs);
    console.log("Discovered " + aiJobs.length + " matching jobs from AI-Jobs.net");
  } catch (e) {
    console.error("Error scraping AI-Jobs: " + e.message);
  }
  
  // 3. Scraping Hacker News Jobs RSS
  try {
    var hnJobs = scrapeRssFeed("https://hnrss.github.io/jobs", keywords, "HackerNews Jobs");
    discoveredJobs = discoveredJobs.concat(hnJobs);
    console.log("Discovered " + hnJobs.length + " matching jobs from Hacker News RSS");
  } catch (e) {
    console.error("Error scraping HN Jobs: " + e.message);
  }

  // 4. Scraping We Work Remotely (Remote Dev / Data Science)
  try {
    var wwrJobs = scrapeRssFeed("https://weworkremotely.com/categories/remote-programming-jobs.rss", keywords, "WeWorkRemotely");
    discoveredJobs = discoveredJobs.concat(wwrJobs);
    console.log("Discovered " + wwrJobs.length + " matching jobs from WeWorkRemotely");
  } catch (e) {
    console.error("Error scraping WeWorkRemotely: " + e.message);
  }

  // 5. Save discovered jobs to Database (deduplication happens in dbAddInternships)
  var newlyAdded = dbAddInternships(discoveredJobs);
  
  return newlyAdded;
}

/**
 * Scrapes SimplifyJobs listings.json directly from GitHub (dev branch)
 */
function scrapeSimplifyJobsJson(keywords) {
  var url = "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json";
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    // Try Summer 2025 as fallback
    url = "https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/.github/scripts/listings.json";
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error("Unable to fetch SimplifyJobs listings JSON. HTTP Code: " + response.getResponseCode());
    }
  }
  
  var content = response.getContentText();
  var rawList = JSON.parse(content);
  var jobs = [];
  
  // Compile regexes for precise word boundary matching
  var regexes = keywords.map(function(kw) {
    var escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    if (kw.length <= 3) {
      return new RegExp('\\b' + escaped + '\\b', 'i');
    }
    return new RegExp(escaped, 'i');
  });
  
  rawList.forEach(function(item) {
    var company = item.company || item.company_name || '';
    var role = item.title || '';
    if (!company || !role) return;
    
    // Check keyword matches
    var matchesKeyword = false;
    for (var i = 0; i < regexes.length; i++) {
      if (regexes[i].test(role)) {
        matchesKeyword = true;
        break;
      }
    }
    if (!matchesKeyword) return;
    
    // Parse locations (can be array or string)
    var location = 'USA / Remote';
    if (item.locations) {
      if (Array.isArray(item.locations)) {
        location = item.locations.join(', ');
      } else {
        location = String(item.locations);
      }
    } else if (item.location) {
      location = String(item.location);
    }
    
    var link = item.url || item.link || '';
    if (!link) return; // Skip if no application URL
    
    var datePosted = '';
    var rawDate = item.date || item.date_posted || '';
    if (rawDate) {
      if (typeof rawDate === 'number') {
        datePosted = new Date(rawDate * 1000).toLocaleDateString();
      } else {
        datePosted = String(rawDate);
      }
    }
    
    jobs.push({
      Company: company,
      Role: role,
      Location: location,
      URL: link,
      Source: 'SimplifyJobs',
      Description: 'Internship position listed on SimplifyJobs. Category: ' + (item.category || 'AI/ML/Data Science'),
      Requirements: 'Apply directly via the application link. Sponsorship details: ' + (item.sponsorship || 'Refer to link'),
      Deadline: datePosted ? 'Posted: ' + datePosted : ''
    });
  });
  
  return jobs;
}

/**
 * Generic RSS XML feed scraper and keyword filter.
 */
function scrapeRssFeed(url, keywords, sourceName) {
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    console.error("Failed to fetch RSS from " + sourceName + ". Code: " + response.getResponseCode());
    return [];
  }
  
  var xml = response.getContentText();
  var document = XmlService.parse(xml);
  var root = document.getRootElement();
  var channel = root.getChild('channel');
  if (!channel) return [];
  var items = channel.getChildren('item');
  
  var jobs = [];
  
  // Compile regexes for precise word boundary matching
  var regexes = keywords.map(function(kw) {
    var escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    if (kw.length <= 3) {
      return new RegExp('\\b' + escaped + '\\b', 'i');
    }
    return new RegExp(escaped, 'i');
  });
  
  items.forEach(function(item) {
    var title = item.getChildText('title') || '';
    var link = item.getChildText('link') || '';
    var description = item.getChildText('description') || '';
    var pubDate = item.getChildText('pubDate') || '';
    
    // Check keyword matches in title or description
    var matches = false;
    var searchStr = title + " " + description;
    for (var i = 0; i < regexes.length; i++) {
      if (regexes[i].test(searchStr)) {
        matches = true;
        break;
      }
    }
    if (!matches) return;
    
    // Deconstruct Company and Role from Title
    var company = sourceName;
    var role = title;
    
    if (title.indexOf(' at ') !== -1) {
      var parts = title.split(' at ');
      role = parts[0].trim();
      company = parts[1].trim();
    } else if (title.indexOf(':') !== -1) {
      var parts = title.split(':');
      company = parts[0].trim();
      role = parts[1].trim();
    }
    
    // Clean description tags
    var cleanDesc = description.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanDesc.length > 1500) {
      cleanDesc = cleanDesc.substring(0, 1500) + '...';
    }
    
    jobs.push({
      Company: company,
      Role: role,
      Location: 'Remote / Hybrid',
      URL: link,
      Source: sourceName,
      Description: cleanDesc,
      Requirements: 'Refer to application link for details.',
      Deadline: pubDate ? 'Posted: ' + pubDate : ''
    });
  });
  
  return jobs;
}

/**
 * Fetch and extract internship details from a custom URL.
 */
function scrapeCustomJobUrl(url) {
  try {
    // 1. Fetch raw HTML
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error("Unable to reach website. HTTP code " + response.getResponseCode());
    }
    
    var html = response.getContentText();
    
    // 2. Extract structured details using Spider Crawler
    var extractedJob = crawlAndExtractJobDetails(html, url);
    
    // Ensure URL and Source matches
    extractedJob.URL = url;
    extractedJob.Source = 'Custom Link';
    
    return extractedJob;
  } catch (e) {
    console.error("Custom crawling failed: " + e.message);
    throw new Error("Aggregator failed to parse careers URL: " + e.message);
  }
}

/**
 * Loop through all jobs in the spreadsheet with AIMatchScore = 0 (uncalculated)
 * and calculate their match scores.
 */
function evaluateUnscoredJobs() {
  var profile = dbGetUserProfile();
  if (!getGeminiApiKey()) {
    console.warn("Skipping AI scoring: No Gemini API Key provided.");
    return;
  }
  
  var jobs = dbGetInternships();
  var unscored = jobs.filter(function(j) { 
    return !j.AIMatchScore || parseInt(j.AIMatchScore, 10) === 0;
  });
  
  console.log("Evaluating " + unscored.length + " unscored jobs...");
  
  var scoredCount = 0;
  for (var i = 0; i < unscored.length; i++) {
    var job = unscored[i];
    try {
      // Small pause to prevent hitting rate limits
      Utilities.sleep(1000);
      
      var assessment = evaluateJobMatch(job.Description, job.Requirements, profile);
      
      dbUpdateInternship(job.ID, {
        AIMatchScore: assessment.score,
        AIRationale: assessment.rationale
      });
      
      logActivity(job.ID, "AI Match Evaluated", "Scored: " + assessment.score + "/100");
      scoredCount++;
    } catch (e) {
      console.error("Failed to evaluate job ID " + job.ID + ": " + e.message);
    }
  }
  
  return scoredCount;
}

/**
 * Custom Spider Crawler: Extract structured job details from raw HTML.
 */
function crawlAndExtractJobDetails(html, url) {
  var job = {
    Company: '',
    Role: '',
    Location: 'Remote / TBD',
    Description: '',
    Requirements: '',
    Deadline: 'Open / Rolling'
  };
  
  // 1. Try JSON-LD first (most structured, standard for Google Jobs search indexing)
  try {
    var jobPosting = extractJsonLd(html);
    if (jobPosting) {
      if (jobPosting.title) job.Role = cleanHtmlTags(jobPosting.title);
      if (jobPosting.hiringOrganization) {
        if (typeof jobPosting.hiringOrganization === 'string') {
          job.Company = cleanHtmlTags(jobPosting.hiringOrganization);
        } else if (jobPosting.hiringOrganization.name) {
          job.Company = cleanHtmlTags(jobPosting.hiringOrganization.name);
        }
      }
      if (jobPosting.jobLocation) {
        if (typeof jobPosting.jobLocation === 'string') {
          job.Location = cleanHtmlTags(jobPosting.jobLocation);
        } else if (jobPosting.jobLocation.address) {
          var addr = jobPosting.jobLocation.address;
          job.Location = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ') || 'Remote';
        }
      }
      if (jobPosting.description) {
        job.Description = cleanHtmlTags(jobPosting.description);
      }
      if (jobPosting.responsibilities || jobPosting.skills || jobPosting.experienceRequirements) {
        var reqParts = [];
        if (jobPosting.responsibilities) reqParts.push(jobPosting.responsibilities);
        if (jobPosting.skills) reqParts.push(jobPosting.skills);
        if (jobPosting.experienceRequirements) reqParts.push(jobPosting.experienceRequirements);
        job.Requirements = cleanHtmlTags(reqParts.join('\n'));
      }
      if (jobPosting.validThrough) {
        job.Deadline = String(jobPosting.validThrough).split('T')[0];
      }
    }
  } catch (e) {
    console.error("JSON-LD crawler parse failed: " + e.message);
  }
  
  // 2. Lever URL Custom Extraction
  if ((!job.Role || !job.Company) && url.indexOf('lever.co') !== -1) {
    try {
      var h2Match = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
      if (h2Match) {
        job.Role = cleanHtmlTags(h2Match[1]);
      }
      var pathParts = url.split('lever.co/');
      if (pathParts.length > 1) {
        var compPart = pathParts[1].split('/')[0];
        job.Company = compPart.charAt(0).toUpperCase() + compPart.slice(1);
      }
      var locMatch = /<div[^>]*class=["']posting-categories["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
      if (locMatch) {
        var locClean = cleanHtmlTags(locMatch[1]).replace(/\s+/g, ' ').trim();
        job.Location = locClean.split('/')[0] || 'Remote';
      }
    } catch(e) {
      console.error("Lever custom crawler failed: " + e.message);
    }
  }

  // 3. Greenhouse URL Custom Extraction
  if ((!job.Role || !job.Company) && url.indexOf('greenhouse.io') !== -1) {
    try {
      var titleMatch = /<h1[^>]*class=["']app-title["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html);
      if (titleMatch) {
        job.Role = cleanHtmlTags(titleMatch[1]);
      }
      var companyMatch = /<span[^>]*class=["']company-name["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
      if (companyMatch) {
        job.Company = cleanHtmlTags(companyMatch[1]).replace(/at\s+/i, '').trim();
      }
      var locMatch = /<div[^>]*class=["']location["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
      if (locMatch) {
        job.Location = cleanHtmlTags(locMatch[1]);
      }
    } catch(e) {
      console.error("Greenhouse custom crawler failed: " + e.message);
    }
  }

  // 4. OpenGraph & Meta Tag fallbacks
  if (!job.Role) {
    var ogTitle = extractMetaTag(html, 'og:title');
    if (ogTitle) {
      var tc = parseTitleAndCompany(ogTitle);
      job.Role = tc.role;
      if (!job.Company) job.Company = tc.company;
    }
  }
  
  if (!job.Company) {
    job.Company = extractMetaTag(html, 'og:site_name') || extractMetaTag(html, 'application-name');
  }

  if (job.Location === 'Remote / TBD') {
    var metaLoc = extractMetaTag(html, 'job_location') || extractMetaTag(html, 'og:locality');
    if (metaLoc) job.Location = metaLoc;
  }
  
  // 5. Title Tag fallback
  if (!job.Role) {
    var titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (titleMatch) {
      var tc = parseTitleAndCompany(cleanHtmlTags(titleMatch[1]));
      job.Role = tc.role;
      if (!job.Company) job.Company = tc.company;
    }
  }

  // Final cleanup and fallbacks
  if (!job.Role) job.Role = 'Internship Position';
  if (!job.Company) {
    try {
      var domain = url.split('://')[1].split('/')[0].replace('www.', '');
      job.Company = domain.split('.')[0].toUpperCase();
    } catch (e) {
      job.Company = 'Unknown Company';
    }
  }

  if (!job.Description) {
    var cleanBody = html
      .replace(/<head[^>]*>([\s\S]*?)<\/head>/gi, '')
      .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
      .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
      .replace(/<footer[^>]*>([\s\S]*?)<\/footer>/gi, '')
      .replace(/<nav[^>]*>([\s\S]*?)<\/nav>/gi, '')
      .replace(/<\/?[^>]+(>|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
      
    if (cleanBody.length > 2000) {
      job.Description = cleanBody.substring(0, 2000) + '...';
    } else {
      job.Description = cleanBody;
    }
    job.Requirements = 'Refer to application link for details.';
  }

  return job;
}

function extractJsonLd(html) {
  var regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var match;
  while ((match = regex.exec(html)) !== null) {
    try {
      var json = JSON.parse(match[1].trim());
      var jobObj = findJobPostingObject(json);
      if (jobObj) return jobObj;
    } catch (e) {
      // ignore parse errors
    }
  }
  return null;
}

function findJobPostingObject(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      var res = findJobPostingObject(obj[i]);
      if (res) return res;
    }
  } else if (typeof obj === 'object') {
    if (obj["@type"] === "JobPosting") {
      return obj;
    }
    if (obj["@graph"] && Array.isArray(obj["@graph"])) {
      return findJobPostingObject(obj["@graph"]);
    }
    for (var key in obj) {
      if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
        var res = findJobPostingObject(obj[key]);
        if (res) return res;
      }
    }
  }
  return null;
}

function extractMetaTag(html, nameOrProperty) {
  var regex = new RegExp('<meta[^>]*?(?:name|property)=["\']' + nameOrProperty + '["\'][^>]*?content=["\']([\\s\\S]*?)["\']', 'i');
  var match = regex.exec(html);
  if (match) return decodeHtmlEntities(match[1].trim());
  
  var regexRev = new RegExp('<meta[^>]*?content=["\']([\\s\\S]*?)["\'][^>]*?(?:name|property)=["\']' + nameOrProperty + '["\']', 'i');
  var matchRev = regexRev.exec(html);
  if (matchRev) return decodeHtmlEntities(matchRev[1].trim());
  
  return '';
}

function parseTitleAndCompany(titleStr) {
  var title = titleStr || '';
  var company = '';
  var role = title;
  
  var splitters = [" at ", " | ", " - ", " — "];
  for (var i = 0; i < splitters.length; i++) {
    var splitter = splitters[i];
    if (title.indexOf(splitter) !== -1) {
      var parts = title.split(splitter);
      if (splitter === " at ") {
        role = parts[0].trim();
        company = parts[1].trim();
      } else {
        var p0 = parts[0].trim();
        var p1 = parts[1].trim();
        
        var roleKeywords = ["intern", "engineer", "developer", "scientist", "fellow", "researcher", "analyst", "manager"];
        var p0Lower = p0.toLowerCase();
        var isP0Role = false;
        for (var j = 0; j < roleKeywords.length; j++) {
          if (p0Lower.indexOf(roleKeywords[j]) !== -1) {
            isP0Role = true;
            break;
          }
        }
        if (isP0Role) {
          role = p0;
          company = p1;
        } else {
          company = p0;
          role = p1;
        }
      }
      break;
    }
  }
  
  return { role: role, company: company };
}

function cleanHtmlTags(str) {
  if (!str) return '';
  return str.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

