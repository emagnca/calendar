const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { ObjectId } = require('mongodb');
const utils = require('./utils');

let sesClient = null;

const sendEmail = async (to, msg, subject='Meddelande från TinyDS') => {
  if (!sesClient) {
    const secret = await utils.getSecret("cal_email");
    const region    = secret?.region     || process.env.EMAIL_REGION;
    const accessKey = secret?.access_key || process.env.EMAIL_ACCESS_KEY;
    const secretKey = secret?.secret_key || process.env.EMAIL_SECRET_KEY;
    const config = { region };
    if (accessKey && secretKey) {
      config.credentials = { accessKeyId: accessKey, secretAccessKey: secretKey };
    }
    sesClient = new SESClient(config);
  }

  const params = {
    Destination: { ToAddresses: [to] },
    Message: {
      Body: { Html: { Charset: "UTF-8", Data: '<p>' + msg + '</p>' } },
      Subject: { Charset: "UTF-8", Data: subject }
    },
    Source: "info@tinyds.se"
  };

  await sesClient.send(new SendEmailCommand(params));
  console.log("Sent email to " + to);
};

function normalizeSmsNumber(phone) {
  let n = String(phone);
  n = n.replace(/^0046/, '0');
  n = n.replace(/^\+46/, '0');
  if (n.startsWith('7')) n = '0' + n;
  return n;
}

const sendSms = async (to, subject, message) => {
  const secret = await utils.getSecret('cal_sms').catch(() => null);
  const key = (typeof secret === 'string' ? secret : secret?.key)
    || process.env.CAL_SMS_KEY;

  const number = normalizeSmsNumber(to);
  const text = subject ? subject + '\n' + message : message;
  const url = 'https://sms.inleed.se/skickaSMS'
    + '?nummer=' + encodeURIComponent(number)
    + '&text='   + encodeURIComponent(text)
    + '&nyckel=' + encodeURIComponent(key);

  try {
    const response = await fetch(url, { method: 'GET' });
    console.log('SMS sent to ' + number + ', status=' + response.status);
  } catch (err) {
    console.error('Failed to send SMS to ' + number + ':', err.message);
  }
};

module.exports = { sendEmail, sendSms };
