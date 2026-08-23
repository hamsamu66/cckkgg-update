class SessionManager {
    constructor() {
        if (!SessionManager.instance) {
            this.session = null;
            SessionManager.instance = this;
        }
        return SessionManager.instance;
    }

    setSession(user, status, limit, licenseVersion, automationVersion) {
        this.session = {
            username: user,
            status: status.toUpperCase(), // FREE, PRO, DISABLED
            limit: limit,
            licenseVersion: licenseVersion,
            automationVersion: automationVersion
        };
    }

    getSession() {
        return this.session;
    }

    clearSession() {
        this.session = null;
    }
}

module.exports = new SessionManager();