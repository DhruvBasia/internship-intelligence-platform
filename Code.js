/**
 * Code.js
 * Entry point for Google Apps Script Web App.
 * Routes HTTP requests, handles RPC actions, and registers triggers.
 */

/**
 * Handle HTTP GET Request to load the frontend Single Page Application (SPA).
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle("Internship Intelligence Platform")
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Inlines file contents directly into templates (CSS & JS modularization).
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Initialize platform database, settings, and return initial state.
 * Called by frontend on page load.
 */
function initPlatform() {
  try {
    var dbInit = initializeDatabase();
    var profile = dbGetUserProfile();
    var jobs = dbGetInternships();
    
    // Auto-seed if database is empty
    if (jobs.length === 0) {
      dbImportTsvData(dbGetDefaultTsvSeed());
      jobs = dbGetInternships();
    }
    
    var logs = dbGetActivityLogs();
    
    // Mask API key for client safety
    if (profile.gemini_api_key) {
      profile.gemini_api_key = "********************";
    }
    
    return {
      success: true,
      profile: profile,
      jobs: jobs,
      logs: logs,
      spreadsheetUrl: dbInit.url,
      spreadsheetId: dbInit.spreadsheetId
    };
  } catch (e) {
    console.error("Initialization failed: " + e.message);
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * RPC: Retrieve all tracked internships.
 */
function getJobs() {
  try {
    return dbGetInternships();
  } catch (e) {
    throw new Error("Failed to load jobs: " + e.message);
  }
}

/**
 * RPC: Save User Profile details and sync triggers.
 */
function saveProfile(profileObj) {
  try {
    // Check if auto scraping has changed
    var oldProfile = dbGetUserProfile();
    var result = dbSaveUserProfile(profileObj);
    
    var autoScrape = String(profileObj.auto_scrape_enabled) === 'true';
    var oldAutoScrape = String(oldProfile.auto_scrape_enabled) === 'true';
    
    if (autoScrape !== oldAutoScrape) {
      setupDailyTrigger(autoScrape);
    }
    
    return result;
  } catch (e) {
    throw new Error("Failed to save profile: " + e.message);
  }
}

/**
 * RPC: Trigger job search aggregation manually.
 */
function triggerManualScrape() {
  try {
    var newJobsCount = aggregateJobs();
    var updatedJobs = dbGetInternships();
    var logs = dbGetActivityLogs();
    return {
      success: true,
      newJobsAdded: newJobsCount,
      jobs: updatedJobs,
      logs: logs
    };
  } catch (e) {
    throw new Error("Job search failed: " + e.message);
  }
}

/**
 * RPC: Add custom careers URL. Scraping content and evaluating score.
 */
function addCustomJobUrl(url) {
  try {
    if (!url || url.indexOf('http') !== 0) {
      throw new Error("Invalid URL format. Include http:// or https://");
    }
    
    // 1. Scrape structured data via Gemini HTML parsing
    var scrapedJob = scrapeCustomJobUrl(url);
    
    // 2. Perform match evaluation
    var profile = dbGetUserProfile();
    var matchResult = evaluateJobMatch(scrapedJob.Description, scrapedJob.Requirements, profile);
    
    scrapedJob.AIMatchScore = matchResult.score;
    scrapedJob.AIRationale = matchResult.rationale;
    scrapedJob.Status = 'Discovered';
    
    // 3. Write to Sheets Database
    var added = dbAddInternships([scrapedJob]);
    if (added === 0) {
      throw new Error("This internship listing (or URL) is already tracked.");
    }
    
    var updatedJobs = dbGetInternships();
    var logs = dbGetActivityLogs();
    
    return {
      success: true,
      job: scrapedJob,
      jobs: updatedJobs,
      logs: logs
    };
  } catch (e) {
    throw new Error("Custom URL aggregator failed: " + e.message);
  }
}

/**
 * RPC: Force recalculating match scores.
 */
function recomputeScore(jobId) {
  try {
    var jobs = dbGetInternships();
    var targetJob = jobs.find(function(j) { return j.ID === jobId; });
    if (!targetJob) throw new Error("Job not found.");
    
    var profile = dbGetUserProfile();
    var assessment = evaluateJobMatch(targetJob.Description, targetJob.Requirements, profile);
    
    dbUpdateInternship(jobId, {
      AIMatchScore: assessment.score,
      AIRationale: assessment.rationale
    });
    
    logActivity(jobId, "AI Match Evaluated", "Manual rescore: " + assessment.score + "/100");
    
    return {
      success: true,
      score: assessment.score,
      rationale: assessment.rationale,
      jobs: dbGetInternships(),
      logs: dbGetActivityLogs()
    };
  } catch (e) {
    throw new Error("Scoring recompute failed: " + e.message);
  }
}

/**
 * RPC: Manually add a job card directly from UI tracker.
 */
function addJobManual(jobData) {
  try {
    jobData.ID = 'JOB_' + Utilities.getUuid().substring(0, 8);
    jobData.DateAdded = new Date();
    
    // Perform quick AI evaluation if details present
    if (getGeminiApiKey() && (jobData.Description || jobData.Requirements)) {
      var profile = dbGetUserProfile();
      var assessment = evaluateJobMatch(jobData.Description, jobData.Requirements, profile);
      jobData.AIMatchScore = assessment.score;
      jobData.AIRationale = assessment.rationale;
    } else {
      jobData.AIMatchScore = 50;
      jobData.AIRationale = "AI model skipped: no details provided or API Key missing.";
    }
    
    dbAddInternships([jobData]);
    
    return {
      success: true,
      jobs: dbGetInternships(),
      logs: dbGetActivityLogs()
    };
  } catch (e) {
    throw new Error("Manual job insertion failed: " + e.message);
  }
}

/**
 * RPC: Update Application tracking status.
 */
function updateJobStatus(jobId, status) {
  try {
    dbUpdateInternshipField(jobId, 'Status', status);
    return {
      success: true,
      jobs: dbGetInternships(),
      logs: dbGetActivityLogs()
    };
  } catch (e) {
    throw new Error("Status sync failed: " + e.message);
  }
}

/**
 * RPC: Edit specific fields (Location, Notes, Deadlines, etc.).
 */
function updateJobFields(jobId, fieldsObj) {
  try {
    dbUpdateInternship(jobId, fieldsObj);
    return {
      success: true,
      jobs: dbGetInternships()
    };
  } catch (e) {
    throw new Error("Field update failed: " + e.message);
  }
}

/**
 * RPC: Generate Custom Cover Letter/SOP.
 */
function generateSOPForJob(jobId) {
  try {
    var jobs = dbGetInternships();
    var job = jobs.find(function(j) { return j.ID === jobId; });
    if (!job) throw new Error("Job not found.");
    
    var profile = dbGetUserProfile();
    var sopText = generateTailoredSOP(job.Company, job.Role, job.Description, profile);
    
    dbSaveSOP(jobId, sopText);
    
    return {
      success: true,
      sopText: sopText,
      jobs: dbGetInternships(),
      logs: dbGetActivityLogs()
    };
  } catch (e) {
    throw new Error("AI cover letter generator failed: " + e.message);
  }
}

/**
 * RPC: Save edited cover letter from client dashboard.
 */
function saveSOPText(jobId, text) {
  try {
    dbSaveSOP(jobId, text);
    return {
      success: true,
      jobs: dbGetInternships()
    };
  } catch (e) {
    throw new Error("Failed to save SOP: " + e.message);
  }
}

/**
 * RPC: Delete Job card.
 */
function deleteJob(jobId) {
  try {
    dbDeleteInternship(jobId);
    return {
      success: true,
      jobs: dbGetInternships(),
      logs: dbGetActivityLogs()
    };
  } catch (e) {
    throw new Error("Deletion failed: " + e.message);
  }
}

/**
 * Register Daily triggers based on settings.
 */
function setupDailyTrigger(enable) {
  var functionName = "aggregateJobsDailyFlow";
  var triggers = ScriptApp.getProjectTriggers();
  
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  if (enable) {
    ScriptApp.newTrigger(functionName)
      .timeBased()
      .everyDays(1)
      .atHour(9)
      .create();
    console.log("Trigger created for daily aggregation at 9:00 AM.");
  }
}

function aggregateJobsDailyFlow() {
  try {
    aggregateJobs();
    if (getGeminiApiKey()) {
      evaluateUnscoredJobs();
    }
    sendGmailAlertsDigest();
  } catch (e) {
    console.error("Daily job aggregation flow failed: " + e.message);
  }
}

/**
 * Scan sheet for high fit matches in the last 24h and notify the user.
 */
function sendGmailAlertsDigest() {
  var profile = dbGetUserProfile();
  var threshold = parseInt(profile.alert_threshold || 75, 10);
  var email = profile.email || Session.getActiveUser().getEmail();
  
  if (!email) {
    console.warn("Gmail alerts skipped: User email missing.");
    return;
  }
  
  var jobs = dbGetInternships();
  var cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);
  
  var matches = jobs.filter(function(job) {
    var dateAdded = new Date(job.DateAdded);
    return job.Status === 'Discovered' && 
           parseInt(job.AIMatchScore, 10) >= threshold && 
           dateAdded >= cutoff;
  });
  
  if (matches.length === 0) {
    console.log("No new jobs exceed alert threshold " + threshold);
    return;
  }
  
  var htmlBody = "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e1e8ed; border-radius: 8px; background-color: #ffffff;'>";
  htmlBody += "<div style='text-align: center; border-bottom: 2px solid #3498DB; padding-bottom: 10px; margin-bottom: 20px;'>";
  htmlBody += "<h1 style='color: #2C3E50; margin: 0; font-size: 24px;'>🤖 Internship Intelligence Platform</h1>";
  htmlBody += "<p style='color: #7F8C8D; margin: 5px 0 0 0;'>Daily High-Fit AI match report</p>";
  htmlBody += "</div>";
  htmlBody += "<p>Hi " + (profile.name || "there") + ",</p>";
  htmlBody += "<p>We found <strong>" + matches.length + " new internships</strong> matching your targeted profile (score threshold >= " + threshold + "%):</p>";
  htmlBody += "<table style='width: 100%; border-collapse: collapse; margin-top: 15px;'>";
  
  matches.forEach(function(job) {
    htmlBody += "<tr><td style='padding: 12px 8px; border-bottom: 1px solid #f1f2f6;'>";
    htmlBody += "<h3 style='margin: 0; color: #2980B9; font-size: 16px;'>" + job.Role + "</h3>";
    htmlBody += "<p style='margin: 3px 0; color: #34495E; font-size: 14px;'><strong>" + job.Company + "</strong> - <em>" + job.Location + "</em></p>";
    htmlBody += "<div style='margin-top: 6px;'><span style='background-color: #2ECC71; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 12px;'>Fit Score: " + job.AIMatchScore + "%</span></div>";
    htmlBody += "<p style='margin: 8px 0; font-size: 13px; color: #7F8C8D; line-height: 1.4;'>" + job.AIRationale + "</p>";
    if (job.URL) {
      htmlBody += "<a href='" + job.URL + "' target='_blank' style='display: inline-block; background-color: #3498DB; color: white; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-size: 12px; margin-top: 5px;'>View Application Page</a>";
    }
    htmlBody += "</td></tr>";
  });
  
  htmlBody += "</table>";
  htmlBody += "<div style='text-align: center; border-top: 1px solid #e1e8ed; padding-top: 15px; margin-top: 20px; font-size: 11px; color: #BDC3C7;'>";
  htmlBody += "To change alerts settings, open the platform UI dashboard and head to Settings.<br>Internship Intelligence Platform © 2026";
  htmlBody += "</div></div>";
  
  GmailApp.sendEmail(email, "🚀 New Internship Matches Discovered (" + matches.length + " items)", "", {
    htmlBody: htmlBody
  });
  
  logActivity("SYSTEM", "Gmail Alert Sent", "Alert email sent with " + matches.length + " jobs to " + email);
}

/**
 * System diagnostic test suite verifying logic before deployments.
 */
function runBackendTests() {
  try {
    console.log("Running self-test sequence...");
    var ss = getDbSpreadsheet();
    console.log("1. Checked Spreadsheet access successfully: " + ss.getName());
    
    initializeDatabase();
    console.log("2. Database sheets created/verified successfully.");
    
    var testProfile = dbGetUserProfile();
    console.log("3. User profile read test pass. Skills target: " + testProfile.skills);
    
    var testJob = {
      Company: "Test Lab",
      Role: "Deep Learning Intern",
      Location: "San Francisco / Hybrid",
      URL: "https://example.com/apply",
      Description: "Research and implement transformers and diffusion models. Requires PyTorch skills.",
      Requirements: "Strong PyTorch, Python coding capability."
    };
    
    var initialJobsCount = dbGetInternships().length;
    var added = dbAddInternships([testJob]);
    console.log("4. Job insertion test pass. Added: " + added);
    
    var currentJobs = dbGetInternships();
    var addedJob = currentJobs.find(function(j) { return j.Company === "Test Lab"; });
    if (!addedJob) throw new Error("Test Job not saved successfully!");
    console.log("5. Verified job data persistence in sheet.");
    
    // Step 5.5: Test TSV Import logic
    var dummyTsv = "Program / Opportunity\tHost Org / Institution\tType\tCountry\tRegion\tField Focus\tMode\tFunded?\tFunding Details\tEligibility (Yr)\tOpen Date\tDeadline\tDuration\tMy Status\tPriority\tFit Score (1-5)\tDocs Ready?\tReferee Asked?\tDate Applied\tOutcome\tOfficial Link\tNotes\n" +
                   "Test Fellow\tTest Host\tGovt\tUK\tEurope\tML\tOnsite\tYes\tPaid\tUG\tJan\tFeb\t8 weeks\tNot Started\tHigh\t5\tNo\tNo\t\tPending\thttps://example.com/test\tSome notes";
    var importedCount = dbImportTsvData(dummyTsv);
    console.log("5.5. TSV Import test pass. Imported: " + importedCount);
    
    // Cleanup the imported test job
    var testJobs = dbGetInternships();
    var testImportedJob = testJobs.find(function(j) { return j.Company === "Test Host"; });
    if (!testImportedJob) throw new Error("TSV Import failed to save record!");
    dbDeleteInternship(testImportedJob.ID);
    
    dbDeleteInternship(addedJob.ID);
    
    // Step 5.6: Test Spider Crawler logic
    var dummyGreenhouseHtml = '<h1 class="app-title">Machine Learning Intern</h1><span class="company-name">at Google DeepMind</span><div class="location">London, UK</div>';
    var crawledJob = crawlAndExtractJobDetails(dummyGreenhouseHtml, "https://boards.greenhouse.io/googledeepmind/jobs/123");
    if (crawledJob.Role !== "Machine Learning Intern" || crawledJob.Company !== "Google DeepMind" || crawledJob.Location !== "London, UK") {
      throw new Error("Spider Crawler failed to parse Greenhouse elements!");
    }
    console.log("5.6. Spider Crawler unit test pass. Extracted: " + crawledJob.Role + " at " + crawledJob.Company);
    
    console.log("6. Cleanup operation completed. Test suite status: PASSED");
    
    return {
      status: "SUCCESS",
      message: "All database tests executed and verified successfully."
    };
  } catch (e) {
    console.error("Test suite failed: " + e.message);
    return {
      status: "FAILURE",
      message: e.message
    };
  }
}

/**
 * RPC: Import spreadsheet data from TSV content.
 */
function importTsvData(tsvText) {
  try {
    var count = dbImportTsvData(tsvText);
    var updatedJobs = dbGetInternships();
    var logs = dbGetActivityLogs();
    return {
      success: true,
      count: count,
      jobs: updatedJobs,
      logs: logs
    };
  } catch (e) {
    throw new Error("TSV Import failed: " + e.message);
  }
}

/**
 * RPC: Retrieve the default TSV seed of 32 flagship internships.
 */
function getDefaultTsvSeed() {
  try {
    return {
      success: true,
      tsvText: dbGetDefaultTsvSeed()
    };
  } catch (e) {
    throw new Error("Failed to get default seed text: " + e.message);
  }
}

