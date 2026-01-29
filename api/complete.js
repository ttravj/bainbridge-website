import { google } from 'googleapis';

// Initialize Google Auth
function getGoogleAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  
  auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
  
  return auth;
}

// Send email via Gmail API
async function sendEmail(auth, to, subject, body) {
  const gmail = google.gmail({ version: 'v1', auth });
  
  const message = [
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `To: ${to}`,
    'From: travis@bainbridgeai.ai',
    `Subject: ${subject}`,
    '',
    body
  ].join('\n');
  
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      labelIds: ['INBOX']
    }
  });
}

// Create Google Doc with discovery brief
async function createDiscoveryDoc(auth, data) {
  const docs = google.docs({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });
  
  const title = `Discovery Brief - ${data.businessName} - ${new Date().toISOString().split('T')[0]}`;
  
  // Create the document
  const doc = await docs.documents.create({
    requestBody: {
      title: title
    }
  });
  
  const docId = doc.data.documentId;
  
  // Move to Discovery_Docs folder
  await drive.files.update({
    fileId: docId,
    addParents: process.env.GOOGLE_FOLDER_ID,
    fields: 'id, parents'
  });
  
  // Build document content
  const content = `DISCOVERY BRIEF
${data.businessName}
Date: ${new Date().toLocaleDateString()}

═══════════════════════════════════════════════════════════

SECTION 1: DISCOVERY SUMMARY

CONTACT INFORMATION
• Name: ${data.prospectName}
• Email: ${data.prospectEmail}
• Business: ${data.businessName}
• Industry: ${data.industry}
• Team Size: ${data.teamSize}

CURRENT STATE
• Tools/Platforms: ${data.currentTools?.join(', ') || 'Not specified'}
• Decision Maker: ${data.decisionMaker ? 'Yes' : 'No / Unknown'}

PAIN POINTS
${data.painPoints?.map(p => `• ${p}`).join('\n') || '• Not specified'}

READINESS
• Urgency: ${data.urgency || 'Not specified'}
• Trigger: ${data.trigger || 'Not specified'}

PROSPECT RECAP (What They Saw)
${data.recap || 'No recap generated'}

═══════════════════════════════════════════════════════════

SECTION 2: INTERNAL NOTES

[Add detailed recommendations, pricing rationale, and proposal strategy here]

RECOMMENDED TIER: [Foundation / Automation / AI Ops]

ESTIMATED VALUE: $[X,XXX - $XX,XXX]

OPEN QUESTIONS:
• 
• 

NEXT STEPS:
• Review and refine discovery brief
• Build custom proposal
• Send within 48 hours
`;

  // Insert content into document
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: content
          }
        }
      ]
    }
  });
  
  return `https://docs.google.com/document/d/${docId}/edit`;
}

// Add row to Google Sheet
async function addToSheet(auth, data, docUrl) {
  const sheets = google.sheets({ version: 'v4', auth });
  
  const now = new Date();
  const dateSubmitted = now.toLocaleDateString();
  
  // Row data matching the 23 columns in Discovery_Intake_Tracker
  const rowData = [
    dateSubmitted,                                    // A: Date Submitted
    data.businessName || '',                          // B: Business Name
    data.prospectName || '',                          // C: Contact Name
    data.prospectEmail || '',                         // D: Email
    data.industry || '',                              // E: Industry
    data.teamSize || '',                              // F: Team Size
    data.painPoints?.[0] || '',                       // G: Primary Pain Point
    data.decisionMaker ? 'Yes' : 'Unknown',           // H: Decision Maker?
    data.urgency || '',                               // I: Urgency
    'Website Chat',                                   // J: Source
    '',                                               // K: Referral Name
    data.currentTools?.join(', ') || '',              // L: Current Platform
    '',                                               // M: Migration Needed?
    '',                                               // N: Estimated Tier
    docUrl || '',                                     // O: Discovery Doc Link
    'New',                                            // P: Status
    '',                                               // Q: Proposal Sent Date
    '',                                               // R: Proposal Amount
    '',                                               // S: Call Scheduled Date
    '',                                               // T: Next Follow-up
    '',                                               // U: Date Closed
    '',                                               // V: Closed Amount
    ''                                                // W: Notes
  ];
  
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Pipeline!A:W',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [rowData]
    }
  });
}

// Main handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { 
      prospectName, 
      prospectEmail, 
      businessName,
      industry,
      teamSize,
      painPoints,
      currentTools,
      decisionMaker,
      urgency,
      trigger,
      recap
    } = req.body;
    
    const auth = getGoogleAuth();
    
    const data = {
      prospectName,
      prospectEmail,
      businessName,
      industry,
      teamSize,
      painPoints,
      currentTools,
      decisionMaker,
      urgency,
      trigger,
      recap
    };
    
    // 1. Create Discovery Doc
    let docUrl = '';
    try {
      docUrl = await createDiscoveryDoc(auth, data);
    } catch (error) {
      console.error('Failed to create doc:', error);
    }
    
    // 2. Add to Google Sheet
    try {
      await addToSheet(auth, data, docUrl);
    } catch (error) {
      console.error('Failed to add to sheet:', error);
    }
    
    // 3. Send notification email to Travis
    const notificationSubject = `New intake received: ${businessName}`;
    const notificationBody = `
      <h2>New Discovery Intake</h2>
      <p><strong>Business:</strong> ${businessName}</p>
      <p><strong>Contact:</strong> ${prospectName}</p>
      <p><strong>Email:</strong> ${prospectEmail}</p>
      <p><strong>Industry:</strong> ${industry}</p>
      <p><strong>Primary Pain:</strong> ${painPoints?.[0] || 'Not specified'}</p>
      <p><strong>Urgency:</strong> ${urgency || 'Not specified'}</p>
      <br>
      <p><a href="${docUrl}">View Discovery Doc</a></p>
    `;
    
    try {
      await sendEmail(auth, 'travis@bainbridgeai.ai', notificationSubject, notificationBody);
    } catch (error) {
      console.error('Failed to send notification email:', error);
    }
    
    // 4. Send confirmation email to prospect
    const firstName = prospectName?.split(' ')[0] || 'there';
    const prospectSubject = 'Your Bainbridge AI assessment is underway';
    const prospectBody = `
      <p>Hi ${firstName},</p>
      
      <p>Thank you for taking the time to walk through the discovery process with us. We have everything we need to build your custom assessment and proposal.</p>
      
      <p>Our team is reviewing your information now. We will have your proposal to you within 48 hours.</p>
      
      <p>In the meantime, if you have any questions or want to chat sooner, feel free to reply to this email or book a call directly: <a href="https://calendar.app.google/abniEgKe1rFuKKXy5">Book a Call</a></p>
      
      <p>Talk soon,</p>
      
      <p>Travis</p>
    `;
    
    if (prospectEmail) {
      try {
        await sendEmail(auth, prospectEmail, prospectSubject, prospectBody);
      } catch (error) {
        console.error('Failed to send prospect email:', error);
      }
    }
    
    return res.status(200).json({ success: true, docUrl });
    
  } catch (error) {
    console.error('Complete API error:', error);
    return res.status(500).json({ 
      error: 'Failed to process completion',
      details: error.message 
    });
  }
}
