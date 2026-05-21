const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'eu-north-1',
    maxAttempts: 1,
    requestTimeout: 5000
});

const _cache = {};

const getSecret = async (name) => {
    if (_cache[name]) return _cache[name];
    console.log('Looking for secret with name:' + name);
    console.log('JSON string:' + process.env[name.toUpperCase()]);
    if (process.env.CAL_PLATFORM !== 'aws') {
        const raw = process.env[name.toUpperCase()];
        try { _cache[name] = JSON.parse(raw); } catch { _cache[name] = raw; }
        return _cache[name];
    }
    const secretId = process.env.CAL_ENV + '/' + name;
    console.log('Looking for secret:' + secretId);
    let response;
    try {
        response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    } catch (error) {
        throw error;
    }
    let parsed = JSON.parse(response.SecretString);
    // Unwrap single-key objects like {"CAL_MONGODB": "{...}"} → parse inner value
    const keys = Object.keys(parsed);
    if (keys.length === 1 && typeof parsed[keys[0]] === 'string') {
        try { parsed = JSON.parse(parsed[keys[0]]); } catch { parsed = parsed[keys[0]]; }
    }
    _cache[name] = parsed;
    return _cache[name];
};

module.exports = { getSecret };
