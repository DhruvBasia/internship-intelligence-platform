/**
 * DatabaseHelper.js
 * Handles spreadsheet initialization, reads, and updates.
 * Acting as a robust ORM layer on top of Google Sheets.
 */

var SHEETS_CONFIG = {
  USER_PROFILE: {
    name: 'UserProfile',
    headers: ['Key', 'Value'],
    defaults: [
      ['name', ''],
      ['email', ''],
      ['skills', 'Python, SQL, PyTorch, Machine Learning, Data Science'],
      ['resume_text', ''],
      ['target_roles', 'Machine Learning, Data Science, AI, Deep Learning, Computer Vision, NLP, ML'],
      ['gemini_api_key', ''],
      ['gemini_model', 'gemini-2.5-flash'],
      ['alert_threshold', '70'],
      ['auto_scrape_enabled', 'false']
    ]
  },
  INTERNSHIPS: {
    name: 'Internships',
    headers: [
      'ID', 'Company', 'Role', 'Location', 'Source', 'URL', 
      'Description', 'Requirements', 'DateAdded', 'Deadline', 
      'AIMatchScore', 'AIRationale', 'Status', 'AppliedDate', 
      'ResumeVersion', 'Notes'
    ]
  },
  ACTIVITY_LOG: {
    name: 'ActivityLog',
    headers: ['ID', 'Timestamp', 'InternshipID', 'ActivityType', 'Details']
  },
  APPLICATIONS: {
    name: 'Applications',
    headers: ['InternshipID', 'SOPText', 'ResumeDriveLink', 'FollowUpDate']
  }
};

/**
 * Gets or creates the backend Spreadsheet.
 */
function getDbSpreadsheet() {
  var props = PropertiesService.getUserProperties();
  var sheetId = props.getProperty('SPREADSHEET_ID');
  
  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {
      console.warn("Stored Spreadsheet ID not accessible, searching Drive...");
    }
  }
  
  // Try searching in Drive
  try {
    var files = DriveApp.getFilesByName("Internship Intelligence Platform Database");
    if (files.hasNext()) {
      var file = files.next();
      props.setProperty('SPREADSHEET_ID', file.getId());
      return SpreadsheetApp.openById(file.getId());
    }
  } catch (e) {
    console.error("Drive permission check failed, creating spreadsheet standard...", e);
  }
  
  // Create a new spreadsheet
  try {
    var newSs = SpreadsheetApp.create("Internship Intelligence Platform Database");
    props.setProperty('SPREADSHEET_ID', newSs.getId());
    
    // Log the created spreadsheet link for reference
    console.log("Database Spreadsheet created at: " + newSs.getUrl());
    return newSs;
  } catch (err) {
    // If standard creation fails, fallback to active spreadsheet if it's container-bound
    try {
      return SpreadsheetApp.getActiveSpreadsheet();
    } catch(activeErr) {
      throw new Error("Unable to create or open Spreadsheet database. Please ensure permissions are correct: " + activeErr.message);
    }
  }
}

/**
 * Initialize all database sheets with headers and default values.
 */
function initializeDatabase() {
  var ss = getDbSpreadsheet();
  
  // 1. Initialize UserProfile Sheet
  var userProfileSheet = ss.getSheetByName(SHEETS_CONFIG.USER_PROFILE.name);
  if (!userProfileSheet) {
    userProfileSheet = ss.insertSheet(SHEETS_CONFIG.USER_PROFILE.name);
    userProfileSheet.appendRow(SHEETS_CONFIG.USER_PROFILE.headers);
    // Add default key-value pairs
    var defaults = SHEETS_CONFIG.USER_PROFILE.defaults;
    for (var i = 0; i < defaults.length; i++) {
      userProfileSheet.appendRow(defaults[i]);
    }
    // Format headers (bold)
    userProfileSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  
  // 2. Initialize Internships Sheet
  var internshipsSheet = ss.getSheetByName(SHEETS_CONFIG.INTERNSHIPS.name);
  if (!internshipsSheet) {
    internshipsSheet = ss.insertSheet(SHEETS_CONFIG.INTERNSHIPS.name);
    internshipsSheet.appendRow(SHEETS_CONFIG.INTERNSHIPS.headers);
    internshipsSheet.getRange(1, 1, 1, SHEETS_CONFIG.INTERNSHIPS.headers.length).setFontWeight('bold');
  }
  
  // 3. Initialize ActivityLog Sheet
  var logSheet = ss.getSheetByName(SHEETS_CONFIG.ACTIVITY_LOG.name);
  if (!logSheet) {
    logSheet = ss.insertSheet(SHEETS_CONFIG.ACTIVITY_LOG.name);
    logSheet.appendRow(SHEETS_CONFIG.ACTIVITY_LOG.headers);
    logSheet.getRange(1, 1, 1, SHEETS_CONFIG.ACTIVITY_LOG.headers.length).setFontWeight('bold');
  }
  
  // 4. Initialize Applications Sheet
  var appSheet = ss.getSheetByName(SHEETS_CONFIG.APPLICATIONS.name);
  if (!appSheet) {
    appSheet = ss.insertSheet(SHEETS_CONFIG.APPLICATIONS.name);
    appSheet.appendRow(SHEETS_CONFIG.APPLICATIONS.headers);
    appSheet.getRange(1, 1, 1, SHEETS_CONFIG.APPLICATIONS.headers.length).setFontWeight('bold');
  }
  
  // Delete the default 'Sheet1' if it exists and is empty
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
  
  return {
    spreadsheetId: ss.getId(),
    url: ss.getUrl()
  };
}

/**
 * Get User Profile as a clean JS Object.
 */
function dbGetUserProfile() {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.USER_PROFILE.name);
  if (!sheet) {
    initializeDatabase();
    sheet = ss.getSheetByName(SHEETS_CONFIG.USER_PROFILE.name);
  }
  
  var data = sheet.getDataRange().getValues();
  var profile = {};
  
  // Start from row 2 (index 1) to skip headers
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    var val = data[i][1];
    if (val instanceof Date) {
      val = val.toISOString();
    }
    profile[key] = val;
  }
  
  // Ensure sensitive key is also populated from UserProperties if missing from Sheet
  var props = PropertiesService.getUserProperties();
  var secretKey = props.getProperty('GEMINI_API_KEY');
  if (secretKey) {
    profile['gemini_api_key'] = secretKey;
  }
  
  // Migration check: Update old restrictive default target_roles
  if (profile['target_roles'] === 'Machine Learning Intern, Data Science Intern, AI Engineer') {
    profile['target_roles'] = 'Machine Learning, Data Science, AI, Deep Learning, Computer Vision, NLP, ML';
    // Update it in the sheet to persist
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === 'target_roles') {
        sheet.getRange(i + 1, 2).setValue(profile['target_roles']);
        break;
      }
    }
  }
  
  return profile;
}

/**
 * Update User Profile settings.
 */
function dbSaveUserProfile(profileObj) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.USER_PROFILE.name);
  if (!sheet) {
    initializeDatabase();
    sheet = ss.getSheetByName(SHEETS_CONFIG.USER_PROFILE.name);
  }
  
  var range = sheet.getDataRange();
  var data = range.getValues();
  
  // Loop through inputs and write them back
  for (var key in profileObj) {
    if (!profileObj.hasOwnProperty(key)) continue;
    
    // Treat API Key separately for security
    if (key === 'gemini_api_key') {
      var keyStr = String(profileObj[key]).trim();
      if (keyStr && keyStr.indexOf('***') === -1) { // Do not overwrite if dummy stars are sent back
        PropertiesService.getUserProperties().setProperty('GEMINI_API_KEY', keyStr);
      }
    }
    
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        // Update value cell (col 2, index i+1)
        var cellVal = key === 'gemini_api_key' ? '********' : profileObj[key];
        sheet.getRange(i + 1, 2).setValue(cellVal);
        found = true;
        break;
      }
    }
    
    if (!found) {
      var cellVal = key === 'gemini_api_key' ? '********' : profileObj[key];
      sheet.appendRow([key, cellVal]);
    }
  }
  
  logActivity("SYSTEM", "Profile Update", "User profile configuration updated");
  return { success: true };
}

/**
 * Get all Internships as an array of Objects.
 */
function dbGetInternships() {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.INTERNSHIPS.name);
  if (!sheet) {
    initializeDatabase();
    sheet = ss.getSheetByName(SHEETS_CONFIG.INTERNSHIPS.name);
  }
  
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length <= 1) return []; // Only headers
  
  var headers = values[0];
  var internships = [];
  
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var item = {};
    for (var c = 0; c < headers.length; c++) {
      var headerName = headers[c];
      var val = row[c];
      if (val instanceof Date) {
        val = val.toISOString();
      }
      item[headerName] = val;
    }
    
    // Add SOP details if they exist in Applications
    item['SOPText'] = dbGetSOP(item['ID']);
    
    internships.push(item);
  }
  
  return internships;
}

/**
 * Batch add new discovered internships.
 * Returns count of newly inserted rows.
 */
function dbAddInternships(jobsList) {
  if (!jobsList || jobsList.length === 0) return 0;
  
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.INTERNSHIPS.name);
  var existingJobs = dbGetInternships();
  
  // Index existing by URL and Company+Role for fast deduplication
  var existingUrls = {};
  var existingKeys = {};
  existingJobs.forEach(function(job) {
    if (job.URL) existingUrls[job.URL.toLowerCase()] = true;
    var key = (job.Company + '|' + job.Role).toLowerCase();
    existingKeys[key] = true;
  });
  
  var headers = SHEETS_CONFIG.INTERNSHIPS.headers;
  var rowsToAdd = [];
  var addedCount = 0;
  
  jobsList.forEach(function(job) {
    var urlLower = job.URL ? job.URL.toLowerCase() : '';
    var key = (job.Company + '|' + job.Role).toLowerCase();
    
    // Deduplicate
    if ((urlLower && existingUrls[urlLower]) || existingKeys[key]) {
      return; // Skip existing
    }
    
    var id = job.ID || 'JOB_' + Utilities.getUuid().substring(0, 8);
    var dateAdded = job.DateAdded || new Date();
    var status = job.Status || 'Discovered';
    
    var row = [];
    headers.forEach(function(header) {
      switch (header) {
        case 'ID': row.push(id); break;
        case 'Company': row.push(job.Company || ''); break;
        case 'Role': row.push(job.Role || ''); break;
        case 'Location': row.push(job.Location || 'Remote/TBD'); break;
        case 'Source': row.push(job.Source || 'Aggregator'); break;
        case 'URL': row.push(job.URL || ''); break;
        case 'Description': row.push(job.Description || ''); break;
        case 'Requirements': row.push(job.Requirements || ''); break;
        case 'DateAdded': row.push(dateAdded); break;
        case 'Deadline': row.push(job.Deadline || ''); break;
        case 'AIMatchScore': row.push(job.AIMatchScore || 0); break;
        case 'AIRationale': row.push(job.AIRationale || ''); break;
        case 'Status': row.push(status); break;
        case 'AppliedDate': row.push(job.AppliedDate || ''); break;
        case 'ResumeVersion': row.push(job.ResumeVersion || ''); break;
        case 'Notes': row.push(job.Notes || ''); break;
        default: row.push('');
      }
    });
    
    rowsToAdd.push(row);
    addedCount++;
    
    // Log discovery
    logActivity(id, "Job Discovered", "New job discovered: " + job.Role + " at " + job.Company);
  });
  
  if (rowsToAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, headers.length).setValues(rowsToAdd);
  }
  
  return addedCount;
}

/**
 * Update a specific field for a given job.
 */
function dbUpdateInternshipField(jobId, fieldName, value) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.INTERNSHIPS.name);
  var range = sheet.getDataRange();
  var values = range.getValues();
  var headers = values[0];
  
  var colIndex = headers.indexOf(fieldName);
  if (colIndex === -1) throw new Error("Field '" + fieldName + "' not found in sheet.");
  
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === jobId) {
      // Row numbers are 1-indexed. r is 0-indexed index. Col index is 0-indexed.
      sheet.getRange(r + 1, colIndex + 1).setValue(value);
      
      // Log application lifecycle changes
      if (fieldName === 'Status') {
        logActivity(jobId, "Status Updated", "Application status set to: " + value);
        if (value === 'Applied') {
          sheet.getRange(r + 1, headers.indexOf('AppliedDate') + 1).setValue(new Date());
        }
      }
      return true;
    }
  }
  return false;
}

/**
 * Update an entire internship entry.
 */
function dbUpdateInternship(jobId, updatedFields) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.INTERNSHIPS.name);
  var range = sheet.getDataRange();
  var values = range.getValues();
  var headers = values[0];
  
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === jobId) {
      for (var fieldName in updatedFields) {
        if (!updatedFields.hasOwnProperty(fieldName)) continue;
        var colIndex = headers.indexOf(fieldName);
        if (colIndex !== -1) {
          sheet.getRange(r + 1, colIndex + 1).setValue(updatedFields[fieldName]);
        }
      }
      return true;
    }
  }
  return false;
}

/**
 * Delete an internship.
 */
function dbDeleteInternship(jobId) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.INTERNSHIPS.name);
  var values = sheet.getDataRange().getValues();
  
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === jobId) {
      sheet.deleteRow(r + 1);
      logActivity(jobId, "Job Deleted", "Internship entry deleted from database");
      return true;
    }
  }
  return false;
}

/**
 * Save or update SOP cover letter for a job.
 */
function dbSaveSOP(jobId, sopText, resumeLink, followUpDate) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.APPLICATIONS.name);
  if (!sheet) {
    initializeDatabase();
    sheet = ss.getSheetByName(SHEETS_CONFIG.APPLICATIONS.name);
  }
  
  var values = sheet.getDataRange().getValues();
  var found = false;
  
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === jobId) {
      sheet.getRange(r + 1, 2).setValue(sopText || '');
      if (resumeLink !== undefined) sheet.getRange(r + 1, 3).setValue(resumeLink);
      if (followUpDate !== undefined) sheet.getRange(r + 1, 4).setValue(followUpDate);
      found = true;
      break;
    }
  }
  
  if (!found) {
    sheet.appendRow([jobId, sopText || '', resumeLink || '', followUpDate || '']);
  }
  
  logActivity(jobId, "SOP Updated", "Custom Cover Letter/SOP saved for job");
  return true;
}

/**
 * Get SOP cover letter text for a job.
 */
function dbGetSOP(jobId) {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.APPLICATIONS.name);
  if (!sheet) return '';
  
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === jobId) {
      return values[r][1] || '';
    }
  }
  return '';
}

/**
 * Log activities and metrics.
 */
function logActivity(jobId, activityType, details) {
  try {
    var ss = getDbSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS_CONFIG.ACTIVITY_LOG.name);
    if (!sheet) return;
    
    var id = 'LOG_' + Utilities.getUuid().substring(0, 8);
    sheet.appendRow([id, new Date(), jobId, activityType, details]);
  } catch (e) {
    console.error("Failed to log activity: ", e.message);
  }
}

/**
 * Get Activity Logs.
 */
function dbGetActivityLogs() {
  var ss = getDbSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS_CONFIG.ACTIVITY_LOG.name);
  if (!sheet) return [];
  
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  
  var logs = [];
  for (var r = 1; r < values.length; r++) {
    var timestamp = values[r][1];
    if (timestamp instanceof Date) {
      timestamp = timestamp.toISOString();
    }
    logs.push({
      ID: values[r][0],
      Timestamp: timestamp,
      InternshipID: values[r][2],
      ActivityType: values[r][3],
      Details: values[r][4]
    });
  }
  return logs.reverse().slice(0, 100); // Return last 100 logs
}

/**
 * Hardcoded dictionary for flagship ML/AI internships to resolve placeholder links.
 */
var KNOWN_INTERNSHIP_LINKS = {
  // International
  "eth student summer research fellowship (ssrf)": "https://inf.ethz.ch/studies/summer-research-fellowship.html",
  "epfl summer@epfl internship": "https://www.epfl.ch/schools/ic/education/summer-at-epfl/",
  "max planck cs research internship": "https://www.imprs-cs.mpg.de/research-internships.html",
  "insait surf fellowship": "https://insait.ai/surf/",
  "deepmind research ready (cambridge)": "https://www.cst.cam.ac.uk/admissions/postgraduate/research-ready",
  "google student researcher (bs/ms)": "https://careers.google.com/jobs/results/?q=Student%20Researcher",
  "kempner institute ug summer internship": "https://kempnerinstitute.harvard.edu/education/undergraduate-summer-internship/",
  "microsoft ug research internship": "https://www.microsoft.com/en-us/research/careers/",
  "mitacs globalink research internship": "https://www.mitacs.ca/our-programs/globalink-research-internship-students/",
  "mila undergraduate research / internship": "https://mila.quebec/en/internship-opportunities/",
  "csiro data61 ug vacation scholarship": "https://www.csiro.au/en/work-with-us/jobs/vacation-scholarships",
  "mbzuai ugrip": "https://mbzuai.ac.ae/ugrip/",
  "kaust vsrp internship": "https://vsrp.kaust.edu.sa/",
  "cern summer student programme": "https://careers.cern/summer",
  "iris@nus / soc internship": "https://www.comp.nus.edu.sg/studentlife/internship/",
  "amazon / aws applied science intern": "https://www.amazon.jobs/",
  "vector institute research programs": "https://vectorinstitute.ai/internships/",
  
  // National (India)
  "ias summer research fellowship (srfp)": "https://web-japps.ias.ac.in/",
  "iit madras summer fellowship programme": "https://sfp.iitm.ac.in/",
  "iit mandi summer internship programme": "https://www.iitmandi.ac.in/",
  "iisc cni research intern": "https://cni.iisc.ac.in/",
  "iisc direct cold-email internship": "https://iisc.ac.in/",
  "iit bombay / fossee / research internships": "https://fossee.in/semester-internship",
  "iiit hyderabad summer research": "https://www.iiit.ac.in/",
  "isro research internship": "https://www.isro.gov.in/",
  "drdo internship": "https://www.drdo.gov.in/",
  "c-cdac internship / project": "https://cdac.in/",
  "microsoft research india internship": "https://www.microsoft.com/en-us/research/lab/microsoft-research-india/",
  "google research india internship": "https://research.google/locations/india/",
  "adobe research india internship": "https://research.adobe.com/careers-at-adobe-research/",
  "samsung / sri-b prism internship": "https://www.samsungprism.com/",
  "wadhwani ai / non-profit ai internship": "https://www.wadhwaniai.org/careers/"
};

/**
 * Import spreadsheet data in TSV format (e.g. copy-pasted from Excel).
 */
function dbImportTsvData(tsvText) {
  if (!tsvText || typeof tsvText !== 'string') {
    throw new Error("Invalid import data: Input must be a TSV string.");
  }
  
  var lines = tsvText.split(/\r?\n/);
  var jobsList = [];
  var addedCount = 0;
  
  // Step 1: Detect if first column is a number in data rows to determine # presence
  var startsWithNumber = false;
  for (var k = 0; k < lines.length; k++) {
    var line = lines[k].trim();
    if (!line) continue;
    if (line.indexOf('#') === 0 || line.indexOf('Program') === 0 || line.indexOf('INTERNSHIP TRACKER') !== -1) {
      continue;
    }
    var cols = line.split('\t');
    if (cols.length > 0 && /^\d+$/.test(cols[0].trim())) {
      startsWithNumber = true;
    }
    break;
  }

  // Set default column indices based on startsWithNumber offset
  var offset = startsWithNumber ? 1 : 0;
  var colIndices = {
    role: offset + 0,
    company: offset + 1,
    type: offset + 2,
    country: offset + 3,
    region: offset + 4,
    fieldFocus: offset + 5,
    mode: offset + 6,
    funded: offset + 7,
    fundingDetails: offset + 8,
    eligibility: offset + 9,
    openDate: offset + 10,
    deadline: offset + 11,
    duration: offset + 12,
    status: offset + 13,
    priority: offset + 14,
    fitScore: offset + 15,
    docsReady: offset + 16,
    refereeAsked: offset + 17,
    dateApplied: offset + 18,
    outcome: offset + 19,
    officialLink: offset + 20,
    notes: offset + 21
  };
  
  // Step 2: Try to detect headers dynamically from the first few lines
  for (var h = 0; h < Math.min(lines.length, 5); h++) {
    var line = lines[h].trim();
    if (!line) continue;
    var cols = line.split('\t');
    if (cols.indexOf('Program / Opportunity') !== -1 || cols.indexOf('Program') !== -1 || cols.indexOf('Host Org') !== -1) {
      for (var c = 0; c < cols.length; c++) {
        var header = cols[c].trim().toLowerCase();
        if (header === '#' || header === 'id') continue;
        if (header.indexOf('program') !== -1 || header.indexOf('opportunity') !== -1) colIndices.role = c;
        else if (header.indexOf('host org') !== -1 || header.indexOf('institution') !== -1 || header.indexOf('company') !== -1) colIndices.company = c;
        else if (header === 'type') colIndices.type = c;
        else if (header === 'country') colIndices.country = c;
        else if (header === 'region') colIndices.region = c;
        else if (header.indexOf('field') !== -1 || header.indexOf('focus') !== -1) colIndices.fieldFocus = c;
        else if (header === 'mode') colIndices.mode = c;
        else if (header === 'funded?') colIndices.funded = c;
        else if (header.indexOf('funding') !== -1) colIndices.fundingDetails = c;
        else if (header.indexOf('eligibility') !== -1) colIndices.eligibility = c;
        else if (header.indexOf('open date') !== -1) colIndices.openDate = c;
        else if (header === 'deadline') colIndices.deadline = c;
        else if (header === 'duration') colIndices.duration = c;
        else if (header.indexOf('status') !== -1) colIndices.status = c;
        else if (header === 'priority') colIndices.priority = c;
        else if (header.indexOf('fit score') !== -1) colIndices.fitScore = c;
        else if (header.indexOf('docs') !== -1) colIndices.docsReady = c;
        else if (header.indexOf('referee') !== -1) colIndices.refereeAsked = c;
        else if (header.indexOf('applied') !== -1) colIndices.dateApplied = c;
        else if (header === 'outcome') colIndices.outcome = c;
        else if (header.indexOf('link') !== -1 || header.indexOf('official') !== -1) colIndices.officialLink = c;
        else if (header === 'notes') colIndices.notes = c;
      }
      break;
    }
  }

  // Step 3: Loop through lines and parse
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    
    // Skip header lines or title comments
    if (line.indexOf('#') === 0 || line.indexOf('Program') === 0 || line.indexOf('INTERNSHIP TRACKER') !== -1) {
      continue;
    }
    
    var cols = line.split('\t');
    if (cols.length < 10) {
      continue;
    }
    
    var role = cols[colIndices.role] ? cols[colIndices.role].trim() : '';
    var company = cols[colIndices.company] ? cols[colIndices.company].trim() : '';
    if (!role || !company) continue;
    
    var type = cols[colIndices.type] ? cols[colIndices.type].trim() : '';
    var country = cols[colIndices.country] ? cols[colIndices.country].trim() : '';
    var region = cols[colIndices.region] ? cols[colIndices.region].trim() : '';
    var fieldFocus = cols[colIndices.fieldFocus] ? cols[colIndices.fieldFocus].trim() : '';
    var mode = cols[colIndices.mode] ? cols[colIndices.mode].trim() : '';
    var funded = cols[colIndices.funded] ? cols[colIndices.funded].trim() : '';
    var fundingDetails = cols[colIndices.fundingDetails] ? cols[colIndices.fundingDetails].trim() : '';
    var eligibility = cols[colIndices.eligibility] ? cols[colIndices.eligibility].trim() : '';
    var openDate = cols[colIndices.openDate] ? cols[colIndices.openDate].trim() : '';
    var deadline = cols[colIndices.deadline] ? cols[colIndices.deadline].trim() : '';
    var duration = cols[colIndices.duration] ? cols[colIndices.duration].trim() : '';
    var rawStatus = cols[colIndices.status] ? cols[colIndices.status].trim() : 'Not Started';
    var priority = cols[colIndices.priority] ? cols[colIndices.priority].trim() : '';
    var rawFitScore = cols[colIndices.fitScore] ? cols[colIndices.fitScore].trim() : '3';
    var docsReady = cols[colIndices.docsReady] ? cols[colIndices.docsReady].trim() : '';
    var refereeAsked = cols[colIndices.refereeAsked] ? cols[colIndices.refereeAsked].trim() : '';
    var dateApplied = cols[colIndices.dateApplied] ? cols[colIndices.dateApplied].trim() : '';
    var outcome = cols[colIndices.outcome] ? cols[colIndices.outcome].trim() : '';
    var officialLink = cols[colIndices.officialLink] ? cols[colIndices.officialLink].trim() : '';
    var rawNotes = cols[colIndices.notes] ? cols[colIndices.notes].trim() : '';
    
    // Normalize status
    var status = 'Discovered';
    if (rawStatus.toLowerCase() === 'not started') {
      status = 'Discovered';
    } else if (['applied', 'interviewing', 'offered', 'rejected', 'archived'].indexOf(rawStatus.toLowerCase()) !== -1) {
      status = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
    }
    
    // Normalize Fit Score
    var fitNum = parseInt(rawFitScore, 10);
    var aiMatchScore = 60;
    if (!isNaN(fitNum)) {
      aiMatchScore = fitNum * 20;
    }
    
    // Resolve link
    var url = officialLink;
    if (!url || url.indexOf('http') !== 0) {
      var key = role.toLowerCase();
      if (KNOWN_INTERNSHIP_LINKS[key]) {
        url = KNOWN_INTERNSHIP_LINKS[key];
      } else {
        url = "https://www.google.com/search?q=" + encodeURIComponent(role + " " + company);
      }
    }
    
    // Build description
    var description = "Type: " + type + "\n" +
                      "Region: " + region + "\n" +
                      "Field Focus: " + fieldFocus + "\n" +
                      "Mode: " + mode + "\n" +
                      "Funded: " + funded + "\n" +
                      "Funding Details: " + fundingDetails + "\n" +
                      "Duration: " + duration + "\n" +
                      "Open Date: " + openDate;
                      
    var requirements = "Eligibility: " + eligibility;
    
    var notes = "Priority: " + priority + "\n" +
                "Docs Ready?: " + docsReady + "\n" +
                "Referee Asked?: " + refereeAsked + "\n" +
                "Outcome: " + outcome + "\n" +
                "Notes: " + rawNotes;
                
    var parsedAppliedDate = '';
    if (dateApplied) {
      try {
        parsedAppliedDate = new Date(dateApplied);
        if (isNaN(parsedAppliedDate.getTime())) {
          parsedAppliedDate = '';
        }
      } catch (e) {
        parsedAppliedDate = '';
      }
    }
    
    jobsList.push({
      ID: 'JOB_' + Utilities.getUuid().substring(0, 8),
      Company: company,
      Role: role,
      Location: country + (mode ? " (" + mode + ")" : ""),
      Source: 'Excel Import',
      URL: url,
      Description: description,
      Requirements: requirements,
      DateAdded: new Date(),
      Deadline: deadline,
      AIMatchScore: aiMatchScore,
      AIRationale: "Imported from curation sheet with curated fit score of " + rawFitScore + "/5.",
      Status: status,
      AppliedDate: parsedAppliedDate,
      ResumeVersion: 'Curated',
      Notes: notes
    });
  }
  
  if (jobsList.length > 0) {
    addedCount = dbAddInternships(jobsList);
    logActivity("SYSTEM", "Data Imported", "Successfully imported " + addedCount + " jobs from TSV text.");
  }
  
  return addedCount;
}

/**
 * Returns the default seeded TSV text block containing the user's 32 curation internships.
 */
function dbGetDefaultTsvSeed() {
  var tsv = "Program / Opportunity\tHost Org / Institution\tType\tCountry\tRegion\tField Focus\tMode\tFunded?\tFunding Details\tEligibility (Yr)\tOpen Date\tDeadline\tDuration\tMy Status\tPriority\tFit Score (1-5)\tDocs Ready?\tReferee Asked?\tDate Applied\tOutcome\tOfficial Link\tNotes\n";
  
  // International listings (17)
  tsv += "ETH Student Summer Research Fellowship (SSRF)\tETH Zurich – Dept of CS\tGovt/University\tSwitzerland\tSwitzerland\tML / CS / Vision\tOnsite (relocate)\tStipend+Travel\tCHF 4000 + airfare + visa + housing\tUG/Masters (enrolled after Sep)\tNov 2025\t~Dec 2025\tJul 1 – Aug 28 (2mo)\tNot Started\tHigh\t5\tNo\tNo\t\tPending\tOpen official page ↗\tNo IELTS / no fee. Flagship. Cycle reopens ~Nov each yr.\n";
  tsv += "EPFL Summer@EPFL Internship\tEPFL\tGovt/University\tSwitzerland\tSwitzerland\tML / CS / DS\tOnsite (relocate)\tStipend+Travel\tSalary + travel reimbursement\t2nd/3rd yr UG in CS/IC\t~Nov\t~Dec\t8–12 weeks (summer)\tNot Started\tHigh\t5\tNo\tNo\t\tPending\tOpen official page ↗\tTop CS school. Verify exact dates each cycle.\n";
  tsv += "Max Planck CS Research Internship\tMPI Informatics / SWS / Security & Privacy\tGovt Research Lab\tGermany\tEurope\tML / Security / CS\tOnsite (relocate)\tFully Funded\tStipend + airfare + housing + visa\tUG (~3 yrs CS done)\tOpen\tNov 1 (summer)\t12–14 weeks\tNot Started\tHigh\t5\tNo\tNo\t\tPending\tOpen official page ↗\tEnglish-only. Co-authorship common.\n";
  tsv += "INSAIT SURF Fellowship\tINSAIT, Sofia University\tGovt/University\tBulgaria\tEurope\tAI / Computing\tOnsite (relocate)\tStipend+Travel\t€1500/mo + accommodation + travel\tUG in STEM\t~Jan\tMar 8\t8–12 weeks\tNot Started\tHigh\t4\tNo\tNo\t\tPending\tOpen official page ↗\tModelled on MIT/ETH/Caltech. Must be on-site in Sofia.\n";
  tsv += "DeepMind Research Ready (Cambridge)\tUniv of Cambridge / Google DeepMind\tGovt/University\tUK\tUK\tAI Research\tOnsite (relocate)\tStipend Only\tPaid 8-week placement\tUG (no prior research needed)\tOpen\tFeb 16\tJul 6 – Aug 28\tNot Started\tMedium\t4\tNo\tNo\t\tPending\tOpen official page ↗\tUK-focused; check residency rules.\n";
  tsv += "Google Student Researcher (BS/MS)\tGoogle / Google DeepMind / Google Research\tCorporate Lab\tUSA\tUSA\tML / AI / DS\tOnsite\tStipend Only\tPaid (competitive salary)\tEnrolled BS/MS\tRolling\tRolling\t12–24 weeks\tNot Started\tHigh\t4\tNo\tN/A\t\tPending\tOpen official page ↗\tMust be located in eligible country. No relocation/visa guarantee.\n";
  tsv += "Kempner Institute UG Summer Internship\tHarvard – Kempner Institute\tNon-Govt/Private\tUSA\tUSA\tML Research & Eng\tOnsite\tStipend Only\tPaid (no visa sponsorship)\tUG full-time\tOpen\tMar 30 (rolling)\t10 weeks (Jun–Aug)\tNot Started\tMedium\t4\tNo\tN/A\t\tPending\tOpen official page ↗\tNO visa sponsorship — verify intl eligibility carefully.\n";
  tsv += "Microsoft UG Research Internship\tMicrosoft Research (Redmond/NY/NE)\tCorporate Lab\tUSA\tUSA\tML / NLP / Vision\tOnsite\tStipend Only\tPaid, 12 weeks\tRising junior/senior\tTBA\tTBA\t12 weeks\tNot Started\tMedium\t4\tNo\tN/A\t\tPending\tOpen official page ↗\t2 yrs programming + ML coursework.\n";
  tsv += "MITACS Globalink Research Internship\t70+ Canadian universities\tGovt/University\tCanada\tCanada\tAI / All STEM\tOnsite (relocate)\tFully Funded\tAirfare + housing + insurance + stipend\tUG, 1–3 sem left\t~Jul\tMid-Sep\t12 weeks (May–Oct)\tNot Started\tHigh\t5\tNo\tNo\t\tPending\tOpen official page ↗\tIndia IS eligible. Apply to 3+ projects in 3+ provinces. Early deadline!\n";
  tsv += "Mila Undergraduate Research / Internship\tMila – Quebec AI Institute\tNon-Profit/Institute\tCanada\tCanada\tDeep Learning / ML\tHybrid\tStipend Only\tPaid research placement\tUG/Masters\tVaries\tVaries\tVaries\tNot Started\tMedium\t4\tNo\tNo\t\tPending\tOpen official page ↗\tOften via supervisor or MITACS. Email profs directly.\n";
  tsv += "CSIRO Data61 UG Vacation Scholarship\tCSIRO Data61\tGovt Research Lab\tAustralia\tAustralia\tAI / DS / ML\tOnsite (relocate)\tStipend Only\tPaid vacation scholarship\tHigh-performing UG\t~Jul (advertised)\t~Aug/Sep\t8–12 wks (Nov–Feb)\tNot Started\tMedium\t4\tNo\tNo\t\tPending\tOpen official page ↗\tAustralian summer. Verify intl eligibility — often AU/NZ focused.\n";
  tsv += "MBZUAI UGRIP\tMohamed bin Zayed Univ of AI\tGovt/University\tUAE\tMiddle East\tAI / ML / CV / NLP\tOnsite (relocate)\tFully Funded\tStipend + accom + travel + visa + insurance\tPenultimate-yr UG, CGPA 3.5+\tJan 1\tFeb 28\t4 weeks (May 31–Jun 26)\tNot Started\tHigh\t5\tNo\tNo\t\tPending\tOpen official page ↗\t~4% acceptance. STEM only. SOP ~400 words.\n";
  tsv += "KAUST VSRP Internship\tKAUST\tGovt/University\tSaudi Arabia\tMiddle East\tAI / CS / DS\tOnsite (relocate)\tFully Funded\tStipend + travel + housing + visa\tUG (3.0+ GPA), 3–6 mo\tOpen\tRolling\t3–6 months\tNot Started\tMedium\t4\tNo\tNo\t\tPending\tOpen official page ↗\tLonger commitment. Strong for pre-PhD.\n";
  tsv += "CERN Summer Student Programme\tCERN\tGovt Research Lab\tSwitzerland\tSwitzerland\tComputing / DS / ML\tOnsite (relocate)\tStipend+Travel\tSubsistence allowance + travel\tUG/Masters in relevant field\t~Nov\t~Jan\t8–13 weeks\tNot Started\tMedium\t3\tNo\tNo\t\tPending\tOpen official page ↗\tPhysics-heavy but strong computing/ML track.\n";
  tsv += "IRIS@NUS / SoC Internship\tNational Univ of Singapore\tGovt/University\tSingapore\tAsia\tAI / CS / DS\tOnsite (relocate)\tStipend+Travel\tStipend + travel support\tUG\tVaries\tVaries\t8–12 weeks\tNot Started\tMedium\t3\tNo\tNo\t\tPending\tOpen official page ↗\tCheck SoC research internship + IRIS programs.\n";
  tsv += "Amazon / AWS Applied Science Intern\tAmazon\tCorporate Lab\tUSA\tGlobal/Remote\tML / Applied Science\tHybrid\tStipend Only\tPaid (high)\tEnrolled UG/MS\tRolling\tRolling\t12–16 weeks\tNot Started\tLow\t3\tNo\tN/A\t\tPending\tOpen official page ↗\tVisa sponsorship varies by office. Filter by location.\n";
  tsv += "Vector Institute Research Programs\tVector Institute\tNon-Profit/Institute\tCanada\tCanada\tDeep Learning / AI\tHybrid\tStipend Only\tVaries by program\tUG/Masters\tVaries\tVaries\tVaries\tNot Started\tLow\t3\tNo\tNo\t\tPending\tOpen official page ↗\tOften via partner universities / MITACS.\n";

  // National (India) listings (15)
  tsv += "IAS Summer Research Fellowship (SRFP)\tIndian Academy of Sciences (IISc + partners)\tGovt/University\tIndia\tIndia\tScience / CS / ML\tOnsite (relocate)\tStipend Only\t₹8,000/mo (or ₹5,000 + ₹2,500 contingency) + train fare\tUG/PG, merit-based\tOct–Nov 2025\t~Nov 2025\t2 months (May–Jul)\tNot Started\tHigh\t5\tNo\tNo\t\tPending\tOpen official page ↗\tEARLY deadline (Nov) — months before IITs. Places at IISc & top labs.\n";
  tsv += "IIT Madras Summer Fellowship Programme\tIIT Madras\tGovt/University\tIndia\tIndia\tCS / ML / DS\tOnsite (relocate)\tStipend Only\t₹15,000/month\tStudents outside IITs\t~Jan\tMar 2\tSummer (2 months)\tNot Started\tHigh\t4\tNo\tNo\t\tPending\tOpen official page ↗\tOpen to non-IIT students. Good stipend.\n";
  tsv += "IIT Mandi Summer Internship Programme\tIIT Mandi\tGovt/University\tIndia\tIndia\tAI & Robotics (CAIR) / CS\tOnsite (relocate)\tStipend Only\t₹10,000/month\tPre-final yr BTech/BE + PG\tFeb\tMar 30\tMay 25 – Jul 24\tNot Started\tHigh\t4\tNo\tNo\t\tPending\tOpen official page ↗\tCentre for AI & Robotics (CAIR). Name a target supervisor.\n";
  tsv += "IISc CNI Research Intern\tIISc – Centre for Networked Intelligence\tGovt/University\tIndia\tIndia\tML / Networks / AI\tOnsite (relocate)\tStipend Only\tFixed monthly stipend (verify)\tUG/PG\tVaries\tVaries\tSummer\tNot Started\tHigh\t4\tNo\tNo\t\tPending\tOpen official page ↗\tDept-specific call. Tighter deadline than national fellowships.\n";
  tsv += "IISc Direct Cold-Email Internship\tIISc faculty (CSA, etc.)\tGovt/University\tIndia\tIndia\tML Theory / AI / Robotics\tOnsite (relocate)\tUnpaid\tStipend only if prof has grant\tUG/PG\tYear-round\tRolling\t2+ months\tNot Started\tMedium\t4\tNo\tNo\t\tPending\tOpen official page ↗\tCSA is theory-heavy. Need specific testable proposal, not 'I know TensorFlow'.\n";
  tsv += "IIT Bombay / FOSSEE / Research Internships\tIIT Bombay\tGovt/University\tIndia\tIndia\tCS / ML / DS\tHybrid\tStipend Only\tVaries by lab\tPre-final / final yr\tVaries\tVaries\t2–6 months\tNot Started\tMedium\t4\tNo\tNo\t\tPending\tOpen official page ↗\tApproach labs directly + check FOSSEE/dept calls.\n";
  tsv += "IIIT Hyderabad Summer Research\tIIIT Hyderabad\tGovt/University\tIndia\tIndia\tAI / NLP / Vision / DS\tOnsite (relocate)\tStipend Only\tStipend varies by centre\tUG (pre-final pref)\t~Feb\t~Mar\tSummer\tNot Started\tHigh\t4\tNo\tNo\t\tPending\tOpen official page ↗\tStrong CV/NLP labs (CVIT, LTRC). Email PIs.\n";
  tsv += "ISRO Research Internship\tISRO / IIST\tGovt Research Lab\tIndia\tIndia\tML / Remote Sensing / DS\tOnsite (relocate)\tUnpaid\tUsually unpaid (project-based)\tUG/PG eng\tVaries\tVaries\tVaries\tNot Started\tLow\t3\tNo\tNo\t\tPending\tOpen official page ↗\tGovt research; competitive, often via institute tie-ups.\n";
  tsv += "DRDO Internship\tDRDO labs\tGovt Research Lab\tIndia\tIndia\tAI / ML / Defence DS\tOnsite (relocate)\tUnpaid\tUsually unpaid\tUG/PG eng\tVaries\tVaries\tVaries\tNot Started\tLow\t3\tNo\tNo\t\tPending\tOpen official page ↗\tCitizenship/clearance constraints. Apply via labs.\n";
  tsv += "C-DAC Internship / Project\tC-DAC\tGovt Research Lab\tIndia\tIndia\tHPC / AI / DS\tHybrid\tStipend Only\tStipend varies\tUG/PG\tVaries\tVaries\tVaries\tNot Started\tLow\t3\tNo\tNo\t\tPending\tOpen official page ↗\tGood for HPC + AI systems (aligns with your background).\n";
  tsv += "Microsoft Research India Internship\tMicrosoft Research India\tCorporate Lab\tIndia\tIndia\tML / Systems / Theory\tOnsite\tStipend Only\tPaid (competitive)\tUG/PG/PhD\tRolling\tRolling\tVaries\tNot Started\tHigh\t5\tNo\tN/A\t\tPending\tOpen official page ↗\tTop-tier industry research in India. Highly competitive.\n";
  tsv += "Google Research India Internship\tGoogle Research India\tCorporate Lab\tIndia\tIndia\tML / NLP / Systems\tOnsite\tStipend Only\tPaid (competitive)\tEnrolled UG/MS/PhD\tRolling\tRolling\t12+ weeks\tNot Started\tHigh\t5\tNo\tN/A\t\tPending\tOpen official page ↗\tApply via Student Researcher (India location).\n";
  tsv += "Adobe Research India Internship\tAdobe Research\tCorporate Lab\tIndia\tIndia\tML / Vision / Multimodal\tHybrid\tStipend Only\tPaid (competitive)\tUG/PG/PhD\tRolling\tRolling\tVaries\tNot Started\tMedium\t4\tNo\tN/A\t\tPending\tOpen official page ↗\tStrong multimodal / vision teams.\n";
  tsv += "Samsung / SRI-B PRISM Internship\tSamsung R&D Bangalore\tCorporate Lab\tIndia\tIndia\tML / Vision / On-device AI\tHybrid\tStipend Only\tStipend + mentorship\tUG (PRISM via college)\tVaries\tVaries\tProject-based\tNot Started\tLow\t3\tNo\tN/A\t\tPending\tOpen official page ↗\tPRISM runs through partner colleges.\n";
  tsv += "Wadhwani AI / Non-profit AI Internship\tWadhwani Institute for AI\tNon-Profit/Institute\tIndia\tIndia\tAI for Social Good / ML\tHybrid\tStipend Only\tStipend (verify)\tUG/PG\tVaries\tVaries\tVaries\tNot Started\tLow\t3\tNo\tNo\t\tPending\tOpen official page ↗\tApplied AI for social impact.\n";
  
  return tsv;
}

