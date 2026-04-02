/**
 * Hitoishi (হিতৈষী) - Premium Backend API
 * Google Apps Script for Google Sheets Database, OTP, and Automation
 */

// ==========================================
// 1. CONFIGURATION (আপনার শিট আইডি এখানে দিন)
// ==========================================
const SPREADSHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE'; 

// ==========================================
// 2. AUTO SETUP (প্রথমবার রান করার জন্য)
// ==========================================
function setupSystem() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  const setupSheet = (name, headers) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#dc2626").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
  };

  // Creating all necessary sheets
  setupSheet('Users', ['ID', 'Name', 'Email', 'Password', 'Phone1', 'Phone2', 'Gender', 'BloodGroup', 'Division', 'District', 'Address', 'ProfilePic', 'Smoker', 'MedicalCondition', 'OTP', 'IsVerified', 'Status', 'CreatedAt']);
  setupSheet('Donations', ['ID', 'UserID', 'Date', 'Hospital', 'Note', 'CreatedAt']);
  setupSheet('Reviews', ['ID', 'DonorID', 'ReviewerName', 'Comment', 'CreatedAt']);
  setupSheet('SiteFunds', ['ID', 'Name', 'Phone', 'TrxID', 'Amount', 'IsAnonymous', 'Status', 'CreatedAt']);
  setupSheet('AdminLogs', ['ID', 'Action', 'Details', 'CreatedAt']);
  
  // Create a time-driven trigger for checking inactive donors (runs once a day)
  const triggers = ScriptApp.getProjectTriggers();
  let triggerExists = false;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkInactiveDonors') {
      triggerExists = true;
      break;
    }
  }
  
  if (!triggerExists) {
    ScriptApp.newTrigger('checkInactiveDonors')
             .timeBased()
             .everyDays(1)
             .atHour(10)
             .create();
  }

  return "Setup Complete! All Sheets and Triggers have been created.";
}


// ==========================================
// 3. API ROUTING (GET & POST)
// ==========================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let response = {};

    if (action === 'register') response = handleRegister(data);
    else if (action === 'verifyOTP') response = handleVerifyOTP(data);
    else if (action === 'login') response = handleLogin(data);
    else if (action === 'searchDonors') response = handleSearch(data);
    else if (action === 'getProfileData') response = handleGetProfile(data);
    else if (action === 'logDonation') response = handleLogDonation(data);
    else if (action === 'submitReview') response = handleSubmitReview(data);
    else if (action === 'submitFund') response = handleSubmitFund(data);
    else if (action === 'getFunds') response = handleGetFunds();
    else response = { status: 'error', message: 'Invalid action.' };

    return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Allow GET for simple pings or public data fetching
  const action = e.parameter.action;
  if(action === 'getFunds') {
      return ContentService.createTextOutput(JSON.stringify(handleGetFunds())).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Hitoishi API is running.' })).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 4. CORE FUNCTIONS
// ==========================================

function handleRegister(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Users');
  const existingData = sheet.getDataRange().getValues();
  
  // Check if Email exists
  for (let i = 1; i < existingData.length; i++) {
    if (existingData[i][2] === data.email) {
      return { status: 'error', message: 'Email is already registered.' };
    }
  }

  const userId = 'UID-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Logic: If user has a medical condition, auto-disable account
  let accountStatus = data.medicalCondition === 'Yes' ? 'Disabled' : 'Active';

  sheet.appendRow([
    userId, data.name, data.email, Utilities.base64Encode(data.password), 
    data.phone1, data.phone2, data.gender, data.bloodGroup, 
    data.division, data.district, data.address, data.profilePic, 
    data.smoker, data.medicalCondition, otp, 'FALSE', accountStatus, new Date().toISOString()
  ]);

  sendOTPEmail(data.email, data.name, otp);

  if(accountStatus === 'Disabled') {
      return { status: 'warning', message: 'অ্যাকাউন্ট তৈরি হয়েছে, তবে আপনার মেডিকেল সমস্যার কারণে রক্তদানের নিয়ম অনুযায়ী অ্যাকাউন্টটি ডিজেবল অবস্থায় থাকবে।', email: data.email };
  }

  return { status: 'success', message: 'OTP sent to email.', email: data.email };
}

function handleVerifyOTP(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Users');
  const values = sheet.getDataRange().getValues();
  
  for (let i = 1; i < values.length; i++) {
    if (values[i][2] === data.email) {
      if (values[i][14].toString() === data.otp.toString()) {
        sheet.getRange(i + 1, 16).setValue('TRUE'); // Set IsVerified to TRUE
        
        if(values[i][16] === 'Disabled') {
             return { status: 'error', message: 'Your account is disabled due to medical conditions.' };
        }

        const userObj = {
          userId: values[i][0], name: values[i][1], email: values[i][2], phone: values[i][4],
          bloodGroup: values[i][7], profilePic: values[i][11]
        };
        return { status: 'success', message: 'Verification successful.', user: userObj };
      } else {
        return { status: 'error', message: 'Invalid OTP.' };
      }
    }
  }
  return { status: 'error', message: 'User not found.' };
}

function handleLogin(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Users');
  const values = sheet.getDataRange().getValues();
  
  const encodedPass = Utilities.base64Encode(data.password);

  for (let i = 1; i < values.length; i++) {
    if (values[i][2] === data.email && values[i][3] === encodedPass) {
      if (values[i][15] !== true && values[i][15] !== 'TRUE') {
        return { status: 'error', message: 'Please verify your email first (OTP).' };
      }
      if (values[i][16] === 'Disabled') {
        return { status: 'error', message: 'Account is disabled.' };
      }
      const userObj = {
        userId: values[i][0], name: values[i][1], email: values[i][2], phone: values[i][4],
        bloodGroup: values[i][7], profilePic: values[i][11]
      };
      return { status: 'success', message: 'Login successful.', user: userObj };
    }
  }
  return { status: 'error', message: 'Invalid email or password.' };
}

function handleSearch(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const donSheet = ss.getSheetByName('Donations');
  const reviewSheet = ss.getSheetByName('Reviews');
  
  const users = userSheet.getDataRange().getValues();
  const donations = donSheet.getDataRange().getValues();
  const reviews = reviewSheet.getDataRange().getValues();
  
  let results = [];
  
  for (let i = 1; i < users.length; i++) {
    const u = users[i];
    // Check if verified and active
    if (u[15] !== true && u[15] !== 'TRUE') continue;
    if (u[16] === 'Disabled') continue;

    let match = true;
    if (data.bloodGroup && u[7] !== data.bloodGroup) match = false;
    if (data.division && u[8] !== data.division) match = false;
    if (data.district && u[9] !== data.district) match = false;

    if (match) {
      // Find last donation
      let lastDonationDate = null;
      for (let j = 1; j < donations.length; j++) {
        if (donations[j][1] === u[0]) {
          let dDate = new Date(donations[j][2]);
          if (!lastDonationDate || dDate > lastDonationDate) lastDonationDate = dDate;
        }
      }

      // Calculate Eligibility
      let eligible = true;
      let waitDays = 0;
      if (lastDonationDate) {
        const diffTime = Math.abs(new Date() - lastDonationDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const requiredDays = u[6] === 'Male' ? 90 : 120;
        if (diffDays < requiredDays) {
          eligible = false;
          waitDays = requiredDays - diffDays;
        }
      }

      // Get Reviews
      let userReviews = [];
      for(let r = 1; r < reviews.length; r++) {
          if(reviews[r][1] === u[0]) {
              userReviews.push({ name: reviews[r][2], comment: reviews[r][3] });
          }
      }

      results.push({
        userId: u[0], name: u[1], bloodGroup: u[7], 
        division: u[8], district: u[9], address: u[10],
        phone1: u[4], phone2: u[5], profilePic: u[11],
        eligible: eligible, waitDays: waitDays, lastDonation: lastDonationDate,
        reviews: userReviews
      });
    }
  }
  return { status: 'success', data: results };
}

function handleGetProfile(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const donSheet = ss.getSheetByName('Donations');
  const values = donSheet.getDataRange().getValues();
  
  let history = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i][1] === data.userId) {
      history.push({ date: values[i][2], hospital: values[i][3], note: values[i][4] });
    }
  }
  return { status: 'success', history: history.reverse() };
}

function handleLogDonation(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Donations');
  const donId = 'DON-' + Utilities.getUuid().substring(0, 6);
  
  sheet.appendRow([donId, data.userId, data.date, data.hospital, data.note, new Date().toISOString()]);
  return { status: 'success', message: 'Donation logged successfully.' };
}

function handleSubmitReview(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Reviews');
  const revId = 'REV-' + Utilities.getUuid().substring(0, 6);
  
  sheet.appendRow([revId, data.donorId, data.reviewerName, data.comment, new Date().toISOString()]);
  return { status: 'success', message: 'Review submitted.' };
}

function handleSubmitFund(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('SiteFunds');
  const fundId = 'FND-' + Utilities.getUuid().substring(0, 6);
  
  sheet.appendRow([fundId, data.name, data.phone, data.trxId, data.amount || 'Pending', data.isAnonymous ? 'Yes' : 'No', 'Pending', new Date().toISOString()]);
  return { status: 'success', message: 'ধন্যবাদ! আপনার অনুদান রিভিউ এর পর ওয়েবসাইটে যুক্ত হবে।' };
}

function handleGetFunds() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('SiteFunds');
  const values = sheet.getDataRange().getValues();
  let funds = [];
  
  for (let i = 1; i < values.length; i++) {
    if(values[i][6] === 'Approved') { // Only show approved funds
       funds.push({
           name: values[i][5] === 'Yes' ? 'Anonymous (' + values[i][0] + ')' : values[i][1],
           date: values[i][7]
       });
    }
  }
  return { status: 'success', data: funds.reverse() };
}

// ==========================================
// 5. UTILS & CRON JOBS
// ==========================================
function sendOTPEmail(recipient, name, otp) {
  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; text-align: center; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #dc2626; margin-bottom: 5px;">Hitoishi (হিতৈষী)</h2>
      <p style="color: #6b7280; font-size: 12px; margin-top:0;">Premium Blood Network</p>
      <p>হ্যালো <b>${name}</b>,</p>
      <p>আপনার অ্যাকাউন্ট তৈরি সম্পন্ন করতে নিচের কোডটি ব্যবহার করুন:</p>
      <h1 style="letter-spacing: 5px; color: #111; background: #f3f4f6; padding: 10px; border-radius: 5px; display: inline-block;">${otp}</h1>
      <p style="font-size: 12px; color: #9ca3af;">এই কোডটি কারো সাথে শেয়ার করবেন না।</p>
    </div>
  `;
  MailApp.sendEmail({ to: recipient, subject: "Verification Code - Hitoishi", htmlBody: htmlBody });
}

// CRON JOB: Checks daily at 10 AM. Sends email if a donor hasn't donated in over 180 days.
function checkInactiveDonors() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const donSheet = ss.getSheetByName('Donations');
  
  const users = userSheet.getDataRange().getValues();
  const donations = donSheet.getDataRange().getValues();
  
  const today = new Date();
  
  for (let i = 1; i < users.length; i++) {
    const u = users[i];
    if (u[15] !== true && u[15] !== 'TRUE') continue; // Not verified
    if (u[16] === 'Disabled') continue;

    let lastDonationDate = null;
    for (let j = 1; j < donations.length; j++) {
      if (donations[j][1] === u[0]) {
        let dDate = new Date(donations[j][2]);
        if (!lastDonationDate || dDate > lastDonationDate) lastDonationDate = dDate;
      }
    }

    if (lastDonationDate) {
      const diffTime = Math.abs(today - lastDonationDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // If hasn't donated in 180 days (6 months)
      if (diffDays === 180) { 
         MailApp.sendEmail({
            to: u[2],
            subject: "আপনি কি রক্তদানে প্রস্তুত? - হিতৈষী",
            htmlBody: `<p>হ্যালো ${u[1]},</p><p>আপনি সর্বশেষ রক্তদান করেছেন প্রায় ৬ মাস আগে। যদি আপনি বর্তমানে সুস্থ থাকেন, তবে আপনার প্রোফাইল আপডেট করে অন্যদের সাহায্য করতে পারেন।</p>`
         });
      }
    }
  }
}
