const jwt = require('jsonwebtoken');
const { getSecret } = require('../utils/utils');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const jwtSecret = await getSecret('cal_jwt_secret');
        const decoded = jwt.verify(token, jwtSecret.secret || jwtSecret);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

module.exports = auth;
