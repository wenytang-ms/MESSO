const axios = require("axios");
const querystring = require("querystring");
const { TeamsActivityHandler, CardFactory, TurnContext } = require("botbuilder");
const rawWelcomeCard = require("./adaptiveCards/welcome.json");
const rawLearnCard = require("./adaptiveCards/learn.json");
const cardTools = require("@microsoft/adaptivecards-tools");
const { TeamsFx, createMicrosoftGraphClient } = require('@microsoft/teamsfx')
const { ResponseType } = require('@microsoft/microsoft-graph-client')
require('isomorphic-fetch');

class TeamsBot extends TeamsActivityHandler {
  constructor() {
    super();
    this.teamsfx = new TeamsFx();
    this.graphClient = null;
    // record the likeCount
    this.likeCountObj = { likeCount: 0 };

    this.onMessage(async (context, next) => {
      console.log("Running with Message Activity.");
      let txt = context.activity.text;
      const removedMentionText = TurnContext.removeRecipientMention(context.activity);
      if (removedMentionText) {
        // Remove the line break
        txt = removedMentionText.toLowerCase().replace(/\n|\r/g, "").trim();
      }

      // Trigger command by IM text
      switch (txt) {
        case "welcome": {
          const card = cardTools.AdaptiveCards.declareWithoutData(rawWelcomeCard).render();
          await context.sendActivity({ attachments: [CardFactory.adaptiveCard(card)] });
          break;
        }
        case "learn": {
          this.likeCountObj.likeCount = 0;
          const card = cardTools.AdaptiveCards.declare(rawLearnCard).render(this.likeCountObj);
          await context.sendActivity({ attachments: [CardFactory.adaptiveCard(card)] });
          break;
        }
        /**
         * case "yourCommand": {
         *   await context.sendActivity(`Add your response here!`);
         *   break;
         * }
         */
      }

      // By calling next() you ensure that the next BotHandler is run.
      await next();
    });

    // Listen to MembersAdded event, view https://docs.microsoft.com/en-us/microsoftteams/platform/resources/bot-v3/bots-notifications for more events
    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded;
      for (let cnt = 0; cnt < membersAdded.length; cnt++) {
        if (membersAdded[cnt].id) {
          const card = cardTools.AdaptiveCards.declareWithoutData(rawWelcomeCard).render();
          await context.sendActivity({ attachments: [CardFactory.adaptiveCard(card)] });
          break;
        }
      }
      await next();
    });
  }

  // Invoked when an action is taken on an Adaptive Card. The Adaptive Card sends an event to the Bot and this
  // method handles that event.
  async onAdaptiveCardInvoke(context, invokeValue) {
    // The verb "userlike" is sent from the Adaptive Card defined in adaptiveCards/learn.json
    if (invokeValue.action.verb === "userlike") {
      this.likeCountObj.likeCount++;
      const card = cardTools.AdaptiveCards.declare(rawLearnCard).render(this.likeCountObj);
      await context.updateActivity({
        type: "message",
        id: context.activity.replyToId,
        attachments: [CardFactory.adaptiveCard(card)],
      });
      return { statusCode: 200 };
    }
  }

  // Message extension Code
  // Action.
  handleTeamsMessagingExtensionSubmitAction(context, action) {
    switch (action.commandId) {
      case "createCard":
        return createCardCommand(context, action);
      case "shareMessage":
        return shareMessageCommand(context, action);
      default:
        throw new Error("NotImplemented");
    }
  }

  async UserConsentd() {
    try {
      const credential = this.teamsfx.getCredential();
      const token = await credential.getToken("User.Read")
      console.log('====================', token)
      if (!token) {
        return false;
      }
    } catch (err) {
      return false;
    }
    return true;
  }

  async getGraphClient() {
    console.log('===================== getGraphClient entry')
    try {
      console.log('===================== getGraphClient step 1')
      this.graphClient = createMicrosoftGraphClient(this.teamsfx, [
        "User.Read",
      ]);
    } catch (err) {
      console.log('-------------------- get graph client error')
      return false;
    }
    return true;
  }

  // Search.
  async handleTeamsMessagingExtensionQuery(context, query) {
    const attachments = [];
    console.log('======================= handleTeamsMessagingExtensionQuery entry')
    if (await this.UserConsentd()) {
      console.log('============================ handleTeamsMessagingExtensionQuery step 1')
      const profile = await this.graphClient.api('/me').get();
      console.log('----------------- ', profile)
      // show user picture
      let photoBinary;
      try {
        photoBinary = await this.graphClient
          .api("/me/photo/$value")
          .responseType(ResponseType.ARRAYBUFFER)
          .get();
      } catch (err) {
        console.log('=============== meet error', err)
        return;
      }

      const buffer = Buffer.from(photoBinary);
      const imageUri = "data:image/png;base64," + buffer.toString("base64");
      console.log('--------- iamge uri ', imageUri);
      const thumbnailCard = CardFactory.thumbnailCard(profile.displayName, CardFactory.images([imageUri]));
      attachments.push(thumbnailCard);
      return {
        composeExtension: {
          type: 'result',
          attachmentLayout: 'list',
          attachments: attachments
        }
      };
    }

    const signInLink = `${this.teamsfx.getConfig("initiateLoginEndpoint")}?scope=${encodeURI(
      ["User.Read"]
    )}&clientId=${this.teamsfx.getConfig("clientId")}&tenantId=${this.teamsfx.getConfig(
      "tenantId"
    )}`;
    console.log('==================== ', signInLink);
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

  async handleTeamsMessagingExtensionSelectItem(context, obj) {
    return {
      composeExtension: {
        type: "result",
        attachmentLayout: "list",
        attachments: [CardFactory.heroCard(obj.name, obj.description)],
      },
    };
  }

  // Link Unfurling.
  handleTeamsAppBasedLinkQuery(context, query) {
    const attachment = CardFactory.thumbnailCard("Thumbnail Card", query.url, [query.url]);

    const result = {
      attachmentLayout: "list",
      type: "result",
      attachments: [attachment],
    };

    const response = {
      composeExtension: result,
    };
    return response;
  }

  async onInvokeActivity(context) {
    const valueObj = context.activity.value;
    if (valueObj.authentication) {
      const authObj = valueObj.authentication;
      if (authObj.token) {
        const ssoToken = authObj.token;
        this.teamsfx.setSsoToken(ssoToken);
        this.graphClient = createMicrosoftGraphClient(this.teamsfx, "User.Read")
        console.log('123123123')
        if (await this.UserConsentd()) {
          return await super.onInvokeActivity(context);
        } else {
          return {
            status: 412
          }
        }
      }
    }
    return await super.onInvokeActivity(context)
  }
}

function createCardCommand(context, action) {
  // The user has chosen to create a card by choosing the 'Create Card' context menu command.
  const data = action.data;
  const heroCard = CardFactory.heroCard(data.title, data.text);
  heroCard.content.subtitle = data.subTitle;
  const attachment = {
    contentType: heroCard.contentType,
    content: heroCard.content,
    preview: heroCard,
  };

  return {
    composeExtension: {
      type: "result",
      attachmentLayout: "list",
      attachments: [attachment],
    },
  };
}

function shareMessageCommand(context, action) {
  // The user has chosen to share a message by choosing the 'Share Message' context menu command.
  let userName = "unknown";
  if (
    action.messagePayload &&
    action.messagePayload.from &&
    action.messagePayload.from.user &&
    action.messagePayload.from.user.displayName
  ) {
    userName = action.messagePayload.from.user.displayName;
  }

  // This Message Extension example allows the user to check a box to include an image with the
  // shared message.  This demonstrates sending custom parameters along with the message payload.
  let images = [];
  const includeImage = action.data.includeImage;
  if (includeImage === "true") {
    images = [
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQtB3AwMUeNoq4gUBGe6Ocj8kyh3bXa9ZbV7u1fVKQoyKFHdkqU",
    ];
  }
  const heroCard = CardFactory.heroCard(
    `${userName} originally sent this message:`,
    action.messagePayload.body.content,
    images
  );

  if (
    action.messagePayload &&
    action.messagePayload.attachment &&
    action.messagePayload.attachments.length > 0
  ) {
    // This sample does not add the MessagePayload Attachments.  This is left as an
    // exercise for the user.
    heroCard.content.subtitle = `(${action.messagePayload.attachments.length} Attachments not included)`;
  }

  const attachment = {
    contentType: heroCard.contentType,
    content: heroCard.content,
    preview: heroCard,
  };

  return {
    composeExtension: {
      type: "result",
      attachmentLayout: "list",
      attachments: [attachment],
    },
  };
}

module.exports.TeamsBot = TeamsBot;
