/**
 * Hitoishi (হিতৈষী) - Premium Backend API
 * Features: OTP, Password, Auto Sheet Setup, Daily Trigger, Reviews, Banning System
 */

const SPREADSHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE'; // আপনার শিটের আইডি দিন

// ==========================================
// 1. SETUP & AUTOMATION (RUN THIS FUNCTION ONCE)
// ==========================================
function setupBackend() {
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

  // Setup Users Sheet
  setupSheet('Users', [
    'ID', 'Name', 'Email', 'Password', 'Phone1', 'Phone2', 'Gender', 'BloodGroup', 
    'Division', 'District', 'DetailedAddress', 'ProfilePic', 'Smoker', 'HasDisease', 
    'LastDonation', 'TotalDonations', 'Status', 'CreatedAt', 'LastLogin'
  ]);
  
  // Setup Temporary OTP Sheet
  setupSheet('TempReg', ['Email', 'OTP', 'Data', 'Expiry']);
  
  // Setup Donations Tracking
  setupSheet('Donations', ['DonationID', 'UserID', 'Date', 'Hospital', 'PatientDetails', 'CreatedAt']);
  
  // Setup Reviews Sheet
  setupSheet('Reviews', ['ReviewID', 'DonorID', 'ReviewerName', 'Comment', 'CreatedAt']);

  // Setup Daily Trigger for Inactive Donors
  setupDailyTrigger();

  return "Setup Complete! Sheets and Triggers are ready.";
}

function setupDailyTrigger() {
  // Delete existing triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkInactiveDonors') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Create a trigger that runs every day at 10 AM
  ScriptApp.newTrigger('checkInactiveDonors')
    .timeBased()
    .everyDays(1)
    .atHour(10)
    .create();
}

// ==========================================
// 2. HTTP METHODS (GET & POST)
// ==========================================
function doOptions(e) {
  return buildCORSResponse(ContentService.createTextOutput(""));
}

function doGet(e) {
  const action = e.parameter.action;
  try {
    if (action === 'getDonors') return buildCORSResponse(getDonors(e.parameter));
    if (action === 'getDonorDetails') return buildCORSResponse(getDonorDetails(e.parameter.id));
    return buildCORSResponse({ status: 'error', message: 'Invalid GET action' });
  } catch (error) {
    return buildCORSResponse({ status: 'error', message: error.toString() });
  }
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;
  try {
    if (action === 'sendOTP') return buildCORSResponse(sendOTP(data));
    if (action === 'verifyOTP') return buildCORSResponse(verifyOTPAndRegister(data));
    if (action === 'login') return buildCORSResponse(loginUser(data));
    if (action === 'addDonation') return buildCORSResponse(addDonation(data));
    if (action === 'addReview') return buildCORSResponse(addReview(data));
    return buildCORSResponse({ status: 'error', message: 'Invalid POST action' });
  } catch (error) {
    return buildCORSResponse({ status: 'error', message: error.toString() });
  }
}

function buildCORSResponse(payload) {
  let output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ==========================================
// 3. CORE FUNCTIONS
// ==========================================

function sendOTP(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName('Users');
  const tempSheet = ss.getSheetByName('TempReg');
  
  // Check if email already exists and not banned
  const users = usersSheet.getDataRange().getValues();
  for(let i=1; i<users.length; i++) {
    if(users[i][2] === data.email) {
      if(users[i][16] === 'Banned') {
         return { status: 'error', message: 'এই ইমেইল দিয়ে অ্যাকাউন্ট তৈরি করা যাবে না (Medical Restriction).' };
      }
      return { status: 'error', message: 'এই ইমেইলটি ইতিমধ্যে ব্যবহৃত হয়েছে।' };
    }
  }

  // Generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = new Date().getTime() + (10 * 60 * 1000); // 10 mins
  
  // Save to Temp
  tempSheet.appendRow([data.email, otp, JSON.stringify(data), expiry]);
  
  // Send Email
  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; text-align: center;">
      <h2 style="color: #dc2626;">Hitoishi (হিতৈষী)</h2>
      <p>হ্যালো <b>${data.name}</b>,</p>
      <p>আপনার অ্যাকাউন্ট ভেরিফিকেশন কোড (OTP) হলো:</p>
      <h1 style="letter-spacing: 5px; color: #dc2626; background: #fef2f2; padding: 10px; border-radius: 5px; display: inline-block;">${otp}</h1>
      <p>এটি আগামী ১০ মিনিট পর্যন্ত কার্যকর থাকবে।</p>
    </div>`;
  
  MailApp.sendEmail({
    to: data.email,
    subject: "Hitoishi (হিতৈষী) - Verify Your Account",
    htmlBody: htmlBody
  });

  return { status: 'success', message: 'OTP পাঠানো হয়েছে আপনার ইমেইলে।' };
}

function verifyOTPAndRegister(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tempSheet = ss.getSheetByName('TempReg');
  const usersSheet = ss.getSheetByName('Users');
  const data = tempSheet.getDataRange().getValues();
  
  let verifiedData = null;
  let rowIndex = -1;
  const now = new Date().getTime();

  for (let i = data.length - 1; i > 0; i--) {
    if (data[i][0] === payload.email && data[i][1].toString() === payload.otp.toString()) {
      if (now > data[i][3]) return { status: 'error', message: 'OTP মেয়াদ উত্তীর্ণ হয়ে গেছে।' };
      verifiedData = JSON.parse(data[i][2]);
      rowIndex = i + 1;
      break;
    }
  }

  if (!verifiedData) return { status: 'error', message: 'ভুল OTP!' };

  // Create User
  const userId = 'DONOR-' + Date.now();
  let status = verifiedData.hasDisease === 'Yes' ? 'Banned' : 'Active'; // Ban if has disease
  
  usersSheet.appendRow([
    userId, verifiedData.name, verifiedData.email, verifiedData.password, 
    verifiedData.phone1, verifiedData.phone2, verifiedData.gender, verifiedData.bloodGroup,
    verifiedData.division, verifiedData.district, verifiedData.detailedAddress, verifiedData.profilePic,
    verifiedData.smoker, verifiedData.hasDisease, '', 0, status, new Date(), new Date()
  ]);

  // Clean Temp Sheet
  tempSheet.deleteRow(rowIndex);

  if(status === 'Banned') {
      return { status: 'success_banned', message: 'আপনার অ্যাকাউন্ট তৈরি হয়েছে কিন্তু মেডিকেল সমস্যার কারণে তা ডিজেবল করা হয়েছে।' };
  }

  return { status: 'success', message: 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!', userId: userId, name: verifiedData.name };
}

function loginUser(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName('Users');
  const users = usersSheet.getDataRange().getValues();

  for (let i = 1; i < users.length; i++) {
    if (users[i][2] === data.email && users[i][3] === data.password) {
      if(users[i][16] === 'Banned') {
          return { status: 'error', message: 'আপনার অ্যাকাউন্টটি ডিজেবল করা আছে।' };
      }
      // Update Last Login
      usersSheet.getRange(i + 1, 19).setValue(new Date());
      
      const userObj = {
        id: users[i][0], name: users[i][1], email: users[i][2], phone1: users[i][4],
        gender: users[i][6], bloodGroup: users[i][7], lastDonation: users[i][14], profilePic: users[i][11]
      };
      return { status: 'success', user: userObj };
    }
  }
  return { status: 'error', message: 'ইমেইল অথবা পাসওয়ার্ড ভুল।' };
}

function getDonors(params) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName('Users');
  const users = usersSheet.getDataRange().getValues();
  
  let results = [];
  
  for (let i = 1; i < users.length; i++) {
    if (users[i][16] === 'Banned') continue; // Skip banned users

    let match = true;
    if (params.bloodGroup && users[i][7] !== params.bloodGroup) match = false;
    if (params.division && users[i][8] !== params.division) match = false;
    if (params.district && users[i][9] !== params.district) match = false;
    
    if (match) {
      results.push({
        id: users[i][0], name: users[i][1], bloodGroup: users[i][7], 
        district: users[i][9], phone: users[i][4], gender: users[i][6], 
        lastDonation: users[i][14], profilePic: users[i][11]
      });
    }
  }
  return { status: 'success', data: results };
}

function getDonorDetails(id) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Get User Details
  const usersSheet = ss.getSheetByName('Users');
  const users = usersSheet.getDataRange().getValues();
  let userDetails = null;
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === id) {
      userDetails = {
        name: users[i][1], phone1: users[i][4], phone2: users[i][5], gender: users[i][6],
        bloodGroup: users[i][7], address: `${users[i][10]}, ${users[i][9]}, ${users[i][8]}`,
        profilePic: users[i][11], smoker: users[i][12], lastDonation: users[i][14], total: users[i][15]
      };
      break;
    }
  }

  if(!userDetails) return { status: 'error', message: 'Donor not found' };

  // Get Reviews
  const reviewsSheet = ss.getSheetByName('Reviews');
  const reviewsData = reviewsSheet.getDataRange().getValues();
  let reviews = [];
  for(let i=1; i<reviewsData.length; i++) {
      if(reviewsData[i][1] === id) {
          reviews.push({ reviewer: reviewsData[i][2], comment: reviewsData[i][3], date: reviewsData[i][4] });
      }
  }

  // Get History
  const donSheet = ss.getSheetByName('Donations');
  const donData = donSheet.getDataRange().getValues();
  let history = [];
  for(let i=1; i<donData.length; i++) {
      if(donData[i][1] === id) {
          history.push({ date: donData[i][2], hospital: donData[i][3] });
      }
  }

  return { status: 'success', user: userDetails, reviews: reviews.reverse(), history: history.reverse() };
}

function addDonation(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const donSheet = ss.getSheetByName('Donations');
  const usersSheet = ss.getSheetByName('Users');
  
  // Add to Donations
  donSheet.appendRow([ 'DON-'+Date.now(), data.userId, data.date, data.hospital, data.details, new Date() ]);
  
  // Update User Last Donation
  const users = usersSheet.getDataRange().getValues();
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === data.userId) {
      usersSheet.getRange(i + 1, 15).setValue(data.date); // Update LastDonation
      usersSheet.getRange(i + 1, 16).setValue(Number(users[i][15]) + 1); // Update Total Donations
      break;
    }
  }
  return { status: 'success', message: 'রক্তদানের তথ্য সফলভাবে সংরক্ষণ করা হয়েছে।' };
}

function addReview(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const reviewSheet = ss.getSheetByName('Reviews');
  reviewSheet.appendRow(['REV-'+Date.now(), data.donorId, data.reviewerName, data.comment, new Date()]);
  return { status: 'success', message: 'আপনার মতামত জমা দেওয়া হয়েছে।' };
}

// ==========================================
// 4. CRON JOBS / TIME TRIGGERS
// ==========================================
function checkInactiveDonors() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const usersSheet = ss.getSheetByName('Users');
  const users = usersSheet.getDataRange().getValues();
  
  const today = new Date();
  
  for (let i = 1; i < users.length; i++) {
    let lastLogin = new Date(users[i][18]);
    let email = users[i][2];
    let name = users[i][1];
    let status = users[i][16];
    
    if(status !== 'Active') continue;

    const diffTime = Math.abs(today - lastLogin);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    
    // If not logged in for 90 days, send reminder
    if (diffDays === 90) {
       MailApp.sendEmail({
        to: email,
        subject: "Hitoishi (হিতৈষী) - আপডেট প্রয়োজন",
        htmlBody: `প্রিয় ${name}, আপনি দীর্ঘ দিন ধরে হিতৈষী ওয়েবসাইটে প্রবেশ করেননি। অনুগ্রহ করে আপনার প্রোফাইল আপডেট রাখুন যাতে প্রয়োজনে কেউ আপনাকে খুঁজে পায়।`
      });
    }
  }
}
