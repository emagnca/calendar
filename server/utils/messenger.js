const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { ObjectId } = require('mongodb');
const utils = require('./utils');

let sesClient = null;

const sendEmail = async (to, msg, subject='Meddelande från TinyDS') => {
  if (!sesClient) {
    const secret = await utils.getSecret("email");
    sesClient = new SESClient({
      region: secret.region,
      credentials: {
        accessKeyId: secret.access_key,
        secretAccessKey: secret.secret_key,
      }
    });
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

const sendSms = async (to, code) => {
  const message = 'Din kod från TinyDS är ' + code;
  const key = 'ixMOqk9xAAmqH3vD11JWT4XLjYV6nZmGx9vXuEv5fSwWV1AX2j';
  const url = 'https://sms.inleed.se/skickaSMS?nummer=' + to + "&nyckel=" + key + "&message=" + message;
  response = await fetch(url, {
      method: 'GET'
  });
  console.log("SMS send status=" + response.status);
};

module.exports = { sendEmail, sendSms };
