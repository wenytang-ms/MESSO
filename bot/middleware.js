const { Middleware, ActivityTypes } = require("botbuilder");
const { TeamsFx } = require('@microsoft/teamsfx')

class ConsentQueryMiddleware {
    constructor(logger = console) {
        this.teamsfx = new TeamsFx();
        this.logger = logger;
    }
    async onTurn(turnContext, next) {
        if (turnContext.activity.type === ActivityTypes.Invoke && turnContext.activity.name === 'composeExtension/query') {
            const valueObj = turnContext.activity.value;
            if (valueObj.authentication) {
                if (!await this.isUserConsent(turnContext)) {
                    const response = { status: 412 }
                    await turnContext.sendActivity({ value: response, type: 'invokeResponse' })
                }
                else {
                    await next();
                }
            }
            else if (!await this.isUserConsent(turnContext)) {
                const body = this.getSignInCardAction();
                const response = { status: 200, body };
                await turnContext.sendActivity({ value: response, type: 'invokeResponse' });
            }
            else {
                try {
                    await next();
                } catch (err) {
                    console.log("================= err:", err);
                }
            }
        }
        else {
            await next();
        }
    }

    getSignInCardAction() {
        const signInLink = `${this.teamsfx.getConfig("initiateLoginEndpoint")}?scope=${encodeURI(
            ["User.Read"]
        )}&clientId=${this.teamsfx.getConfig("clientId")}&tenantId=${this.teamsfx.getConfig(
            "tenantId"
        )}`;
        return {
            composeExtension: {
                type: 'silentAuth',
                suggestedActions: {
                    actions: [
                        {
                            type: 'openUrl',
                            value: signInLink,
                            title: 'Bot Service OAuth'
                        }
                    ]
                }
            }
        }
    }

    async isUserConsent(context) {
        console.log('================================= isUserConsent!!!!!')
        const valueObj = context.activity.value;
        if (!(valueObj.authentication && valueObj.authentication.token))
            return false
        try {
            this.teamsfx.setSsoToken(valueObj.authentication.token)
            console.log('============= this is isUserConsent step 1')
            const credential = this.teamsfx.getCredential();
            console.log('============= this is isUserConsent step 2')
            const token = await credential.getToken("User.Read")
            if (!token) {
                return false;
            }
            console.log('============= this is isUserConsent step 3')
        } catch (err) {
            return false;
        }
        return true;
    }
}

module.exports.ConsentQueryMiddleware = ConsentQueryMiddleware;