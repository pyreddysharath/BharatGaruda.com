/**
 * feedback_apps_script.gs
 *
 * Paste this into a Google Sheet's Apps Script editor (Extensions > Apps
 * Script), deploy it as a Web App, and point FEEDBACK_ENDPOINT in
 * index.html at the deployment URL. Every feedback submission on
 * the site will then also be appended as a new row here, in real time,
 * from every visitor — not just stored in one person's browser.
 *
 * SETUP
 * 1. Create a new Google Sheet (sheets.new).
 * 2. In row 1, add headers:  Date | Website | Name | Message | Status
 * 3. Extensions > Apps Script. Delete the placeholder code and paste
 *    in everything below.
 * 4. Click Deploy > New deployment.
 *      - Click the gear icon next to "Select type" and choose "Web app".
 *      - Description: anything, e.g. "Feedback receiver"
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 5. Click Deploy. The first time, Google will ask you to authorize
 *    the script — approve it (it's your own script, acting on your
 *    own sheet).
 * 6. Copy the "Web app URL" shown after deploying (it ends in /exec).
 * 7. In index.html, find:
 *        const FEEDBACK_ENDPOINT = ...;
 *    and set it to your deployed Web App URL.
 *
 * That's it — no API keys, no billing, this runs on Google's free tier
 * for personal Apps Script usage.
 *
 * NOTE: If you ever change the form's fields, update the `e.parameter`
 * lookups below to match.
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var date = (e.parameter && e.parameter.Date) || Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
    var website = (e.parameter && e.parameter.Website) || '';
    var name = (e.parameter && e.parameter.Name) || '';
    var message = (e.parameter && e.parameter.Message) || '';
    var status = (e.parameter && e.parameter.Status) || '';

    sheet.appendRow([date, website, name, message, status]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Lets you sanity-check the deployment by visiting the URL directly
// in a browser — you should see this text instead of an error page.
function doGet(e) {
  return ContentService.createTextOutput('Feedback endpoint is live. POST submissions will be appended below the header row.');
}