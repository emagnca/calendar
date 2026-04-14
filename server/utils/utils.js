const getSecret = async (name) => {
    if (name === 'email') {
        return {
            region: process.env.EMAIL_REGION,
            access_key: process.env.EMAIL_ACCESS_KEY,
            secret_key: process.env.EMAIL_SECRET_KEY,
        };
    }
    throw new Error(`Unknown secret: ${name}`);
};

module.exports = { getSecret };
