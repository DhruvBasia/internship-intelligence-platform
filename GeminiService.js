/**
 * GeminiService.js
 * Interfaces with Google Gemini API (gemini-1.5-flash) to evaluate job postings,
 * compute match scores, extract structured data, and draft SOPs.
 */

function getGeminiApiKey() {
  var props = PropertiesService.getUserProperties();
  var apiKey = props.getProperty('GEMINI_API_KEY');
  
  if (!apiKey) {
    apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  }
  
  if (apiKey) {
    apiKey = apiKey.trim();
    if (apiKey.length > 100) {
      // Clean invalid keys to prevent infinite loops
      props.deleteProperty('GEMINI_API_KEY');
      throw new Error("The saved Gemini API Key is invalid (too long: " + apiKey.length + " chars). It has been cleared from properties. Please paste a valid 39-character key from Google AI Studio.");
    }
  }
  
  return apiKey;
}

function getGeminiModel() {
  try {
    var profile = dbGetUserProfile();
    return profile.gemini_model || 'gemini-2.5-flash';
  } catch (e) {
    return 'gemini-2.5-flash';
  }
}

/**
 * Base utility to execute Gemini API requests.
 */
function callGeminiAPI(prompt, systemInstruction, returnJson) {
  var apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please configure it in Settings.");
  }
  
  var modelName = getGeminiModel();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + apiKey;
  
  var payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ]
  };
  
  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [
        { text: systemInstruction }
      ]
    };
  }
  
  var generationConfig = {};
  if (returnJson) {
    generationConfig.responseMimeType = "application/json";
  }
  payload.generationConfig = generationConfig;
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    if (responseCode !== 200) {
      console.error("Gemini API Error details: " + responseText);
      var errJson = JSON.parse(responseText);
      var errMsg = errJson.error ? errJson.error.message : "HTTP Code " + responseCode;
      throw new Error("Gemini API Error: " + errMsg);
    }
    
    var result = JSON.parse(responseText);
    var textOutput = result.candidates[0].content.parts[0].text;
    
    if (returnJson) {
      // Clean potential markdown code blocks if the API returned it inside ```json ... ```
      var cleanedText = textOutput.trim();
      if (cleanedText.indexOf('```json') === 0) {
        cleanedText = cleanedText.substring(7);
        if (cleanedText.lastIndexOf('```') === cleanedText.length - 3) {
          cleanedText = cleanedText.substring(0, cleanedText.length - 3);
        }
      } else if (cleanedText.indexOf('```') === 0) {
        cleanedText = cleanedText.substring(3);
        if (cleanedText.lastIndexOf('```') === cleanedText.length - 3) {
          cleanedText = cleanedText.substring(0, cleanedText.length - 3);
        }
      }
      return JSON.parse(cleanedText.trim());
    }
    
    return textOutput;
  } catch (e) {
    console.error("UrlFetch exception in callGeminiAPI: " + e.message);
    throw new Error("Failed to communicate with AI model: " + e.message);
  }
}

/**
 * Call Gemini to match a Job against a User's resume/skills.
 */
function evaluateJobMatch(jobDescription, jobRequirements, userProfile) {
  if (!userProfile.resume_text && !userProfile.skills) {
    return {
      score: 50,
      rationale: "User resume and skills profile are empty. Set up your profile in Settings to get real AI matching."
    };
  }
  
  var systemInstruction = "You are an AI Job Matching Expert. Your task is to evaluate how closely an internship listing matches a candidate's resume, skills, and target roles. Output a valid JSON object matching the requested schema. Be objective, realistic, and call out skill gaps clearly.";
  
  var prompt = "Candidate Resume:\n" + (userProfile.resume_text || "No resume text uploaded.") + "\n\n" +
               "Candidate Skills:\n" + (userProfile.skills || "") + "\n\n" +
               "Target Roles:\n" + (userProfile.target_roles || "") + "\n\n" +
               "Job Description:\n" + jobDescription + "\n\n" +
               "Job Requirements:\n" + jobRequirements + "\n\n" +
               "Please analyze the job description and compare it with the candidate's profile. " +
               "Calculate an overall AI Match Score (0 to 100). Write a concise, bulleted Rationale analyzing matches, gaps, and recommendations.\n\n" +
               "Provide your response EXACTLY as a JSON object of this schema:\n" +
               "{\n" +
               "  \"score\": 78,\n" +
               "  \"rationale\": \"• Strong fit: PyTorch and Python matching\\n• Gaps: Candidate lacks Kubernetes experience requested\\n• Action: Emphasize model deployment projects in SOP\"\n" +
               "}";
               
  try {
    var response = callGeminiAPI(prompt, systemInstruction, true);
    var score = parseInt(response.score, 10);
    if (isNaN(score)) score = 50;
    
    return {
      score: score,
      rationale: response.rationale || "No rationale provided."
    };
  } catch (e) {
    console.error("Match calculation failed: " + e.message);
    return {
      score: 0,
      rationale: "Error calculating score: " + e.message
    };
  }
}

/**
 * Generate customized cover letter or SOP.
 */
function generateTailoredSOP(jobCompany, jobRole, jobDescription, userProfile) {
  var systemInstruction = "You are a professional Career Advisor and technical Writer. Write custom, tailored Cover Letters/Statement of Purpose documents that link a user's actual projects and experience to the internship description. Focus on metrics, impact, and project accomplishments.";
  
  var prompt = "Candidate Name: " + (userProfile.name || "Candidate") + "\n" +
               "Candidate Email: " + (userProfile.email || "") + "\n" +
               "Candidate Resume:\n" + (userProfile.resume_text || "") + "\n\n" +
               "Candidate Skills:\n" + (userProfile.skills || "") + "\n\n" +
               "Internship Target:\n" + jobRole + " at " + jobCompany + "\n\n" +
               "Job Description:\n" + jobDescription + "\n\n" +
               "Please write a professional, highly targeted Cover Letter (approx 350-450 words). " +
               "Do not use generic templates. Instead, reference specific skills, tools, and projects " +
               "from the candidate's resume that match the job description. Structure it cleanly with: \n" +
               "1. Header details (Date, contact)\n" +
               "2. Introduction stating interest in the specific role\n" +
               "3. Alignment paragraphs demonstrating competence using their real projects\n" +
               "4. Closing/Call to action.\n\n" +
               "Make the tone confident, professional, and technical.";
               
  try {
    return callGeminiAPI(prompt, systemInstruction, false);
  } catch (e) {
    console.error("SOP generation failed: " + e.message);
    return "Error generating Statement of Purpose: " + e.message;
  }
}

/**
 * Parse raw text/HTML scraped from a career portal to extract internship details.
 */
function extractJobFieldsFromRawText(rawText) {
  var systemInstruction = "You are an Information Extraction Specialist. Extract structured job details from raw webpage text. Output a valid JSON object matching the requested schema.";
  
  var prompt = "Analyze the following raw scraped text from a job page:\n\n" +
               rawText + "\n\n" +
               "Identify and extract the following details. If any field cannot be found, return empty string.\n" +
               "- Company Name\n" +
               "- Role/Title (e.g., 'ML Intern', 'AI Researcher')\n" +
               "- Location (e.g., 'New York, NY', 'Remote', 'TBD')\n" +
               "- Job Description Summary\n" +
               "- Job Requirements / Qualifications list\n" +
               "- Application Deadline or Date Posted\n" +
               "- Application / Careers Link (if visible in text, or leave blank)\n\n" +
               "Provide your response EXACTLY as a JSON object of this schema:\n" +
               "{\n" +
               "  \"Company\": \"Company Name\",\n" +
               "  \"Role\": \"Role Title\",\n" +
               "  \"Location\": \"Location\",\n" +
               "  \"Description\": \"Concise paragraph summarizing the role...\",\n" +
               "  \"Requirements\": \"Bullet list of key requirements...\",\n" +
               "  \"Deadline\": \"YYYY-MM-DD or readable string\",\n" +
               "  \"URL\": \"Link if found\"\n" +
               "}";
               
  try {
    return callGeminiAPI(prompt, systemInstruction, true);
  } catch (e) {
    console.error("Text extraction failed: " + e.message);
    throw new Error("AI extraction failed: " + e.message);
  }
}
