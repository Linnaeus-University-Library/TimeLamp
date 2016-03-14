'use strict';

const slackConfig = require('../slackConfig.json');
const lampConfig = require('../lampConfig.json');
const https = require('https');
const hashTags = require('../hashtags.json');
const channelConfig = require('../channels.json');
const LightHandler = require('../../lightHandler/lightHandler.js');
const async = require('asyncawait/async');
const await = require('asyncawait/await');
const Jsonfile = require('jsonfile');
const usersFile = require('../users.json');


const MessageHandler = class {

    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
        this.lightHandler = new LightHandler();
        this.setupCoolDownCounters();
    }

    /**
     * Setup cooldown-counters for all channels.
     */
    setupCoolDownCounters() {
        this.coolDownCounters = {};
        this.elements = [];
        const channels = Jsonfile.readFileSync('./channels.json');

        for (let channel of channels) {
            this.elements.push(channel.id);
        }

        for (let i = this.elements.length; i--; ) {
            this.coolDownCounters[this.elements[i]] = 0;
        }
    }

    /**
     * Initiate cooldown-effect for Philips Hue.
     *
     * @param channelID
     */
    initCoolDown(channelID) {
        this.coolDownCounters[channelID] = 15;
        setInterval(() => {
            if (this.coolDownCounters[channelID] > 0)
                this.coolDownCounters[channelID] -= 1;
            else clearInterval();
        }, 1000);
    }

    /**
     * Sort out all messages containing valid hashtags.
     *
     * @param message
     */
    handleMessage(message) {
        console.log(message);
        let msg = JSON.parse(message.utf8Data);

        if (msg.type === 'message' &&
            msg.hasOwnProperty('text') &&
            msg.text.includes('#')) {

            // TODO: Uncomment for live-filtering!
            //if (this.isLectureLive(msg)) {
                msg = this.sortValidHashTags(msg);
                if (msg.hasOwnProperty('hashTags'))
                    this.handleValidHashTags(msg);
            //}
        }
    }

    /**
     * Verify if the lecture is live.
     *
     * @param message
     * @returns {boolean}
     */
    isLectureLive(message) {
        const messageTimeStamp = message.ts;
        let lectureStartTime;
        let lectureEndTime;

        for (let channel of channelConfig) {
            if (channel.id === message.channel) {
                if (message.hasOwnProperty('todayStartTime') &&
                    message.hasOwnProperty('todayEndTime')) {
                    lectureStartTime = channel.todayStartTime;
                    lectureEndTime = channel.todayEndTime;
                }
            }
        }

        if (lectureStartTime && lectureEndTime) {
            lectureStartTime = this.convertToMilliseconds(lectureStartTime);
            lectureEndTime = this.convertToMilliseconds(lectureEndTime);

            if (messageTimeStamp >= lectureStartTime &&
                messageTimeStamp <= lectureEndTime) {
                return true;
            }
        }
        return false;
    }

    /**
     * Convert time ("hh:mm") to milliseconds.
     *
     * @param time
     * @returns {number|*}
     */
    convertToMilliseconds(time) {
        const today = new Date();
        today.setHours(time.substring(0, 2));
        today.setMinutes(time.substring(3, 5));
        today.setSeconds(0);
        time = +today; // '+' Converts to milliseconds.
        return time;
    }

    /**
     * Sort out all valid hashtags.
     * Save them as a new message-property.
     *
     * @param message
     * @returns {*}
     */
    sortValidHashTags(message) {
        let validHashTags = [];

        for (let hashTag of hashTags) {
            const validHashTag = hashTag.hashTag;
            const text = message.text;
            if (this.isValidHashTagIncluded(text, validHashTag))
                validHashTags.push(validHashTag);
        }

        if (validHashTags.length > 0)
            message["hashTags"] = validHashTags;

        return message;
    }

    /**
     * Verify that the valid hashtag is correctly
     * included in message.
     *
     * @param text
     * @param validHashTag
     * @returns {boolean}
     */
    isValidHashTagIncluded(text, validHashTag) {
        switch (true) {
            case text === validHashTag:
            case text.startsWith(`${validHashTag} `):
            case text.includes(` ${validHashTag} `):
            case text.endsWith(` ${validHashTag}`):
                return true;
            default: return false;
        }
    }

    /**
     * Iterate through all valid hashtags.
     * Call appropriate function.
     *
     * @param message
     */
    handleValidHashTags(message) {
        const self = this;
        const cases = {
            '#!': this.handleStreamProblem,
            '#?': this.handleUserQuestion,
            '#I': this.handleInfoRequest
        };

        for (let hashTag of message.hashTags) {
            if (cases[hashTag])
                cases[hashTag](message, self);
        }
    }

    /**
     * Post Bot-response to channel.
     * Call 'LightHandler' if no cooldown.
     *
     * @param message
     * @param self
     */
    handleStreamProblem(message, self) {
        const channelID = message.channel;
        const botMessage = slackConfig.problemMessage;
        const userName = self.getUserName(message.user);
        self.postBotMessageToChannel(channelID, botMessage, userName);

        if (self.coolDownCounters[channelID] == 0) {
            self.initCoolDown(channelID);
            const lampID = self.getLampID(message);
            const lampColor = lampConfig.problemColor;
            self.callLightHandler(lampID, lampColor);
        }
    }

    /**
     * Post Bot-response to channel.
     * Call 'LightHandler' if no cooldown.
     *
     * @param message
     * @param self
     */
    handleUserQuestion(message, self) {
        const channelID = message.channel;
        const botMessage = slackConfig.questionMessage;
        const userName = self.getUserName(message.user);
        self.postBotMessageToChannel(channelID, botMessage, userName);

        if (self.coolDownCounters[channelID] == 0) {
            self.initCoolDown(channelID);
            const lampID = self.getLampID(message);
            const lampColor = lampConfig.questionColor;
            self.callLightHandler(lampID, lampColor);
        }

        // Add channel-name to message.
        const channelName = self.getChannelName(channelID);
        message["channelName"] = channelName;

        //this.eventEmitter.emit('userQuestion', message);
    }

    /**
     * Post Bot-response to channel.
     * Call 'LightHandler' if no cooldown.
     *
     * @param message
     * @param self
     */
    handleInfoRequest(message, self) {
        const channelID = message.channel;
        const botMessage = slackConfig.infoMessage;
        const userName = self.getUserName(message.user);
        self.postBotMessageToChannel(channelID, botMessage, userName);
    }

    /**
     * Search 'channels.json' for lamp-ID by channel-ID.
     *
     * @param message
     * @returns {*}
     */
    getLampID(message) {
        const channelID = message.channel;

        for (let channel of channelConfig) {
            if (channelID == channel.id) {
                return channel.lampID;
            }
        }
    }

    /**
     * Get channel-name by channel-ID.
     * 
     * @param channelID
     * @returns {*}
     */
    getChannelName(channelID) {
        for (let channel of channelConfig) {
            if (channel.id == channelID) {
                return channel.name;
            }
        }
    }

    /**
     * Get username from 'users.json' by ID.
     *
     * @param userID
     * @returns {string}
     */
    getUserName(userID) {
        for (let user of usersFile) {
            if (user.id === userID) {
                return user.name;
            }
        }
    }

    /**
     * Call 'LightHandler' (Philips Hue).
     *
     * @param lampID
     * @param color
     */
    callLightHandler(lampID, color) {
        this.lightHandler.setWarning(
            lampID,
            lampConfig.blinkRate,
            lampConfig.duration,
            color
        );
    }

    /**
     * POST Bot-response to channel
     * in which message has been sent.
     *
     * @param channel
     * @param botMessage
     * @param user
     */
    postBotMessageToChannel(channelID, botMessage, userName) {
        const path =
            `/api/chat.postMessage
            ?token=${slackConfig.token}
            &channel=${channelID}
            &text=${userName}:${encodeURIComponent(botMessage)}
            &username=${slackConfig.botName}
            &icon_url=${encodeURIComponent(slackConfig.botImageURL)}`
            .replace(/\s+/g, ''); // Escape spaces.

        const options = {
            hostname: slackConfig.hostName,
            path: path,
            method: 'POST'
        };

        const req = https.request(options, res => {
            console.log(res.statusCode);
            console.log(res.statusMessage);
        });
        req.end();

        req.on('error', error =>
            this.handleError(error));
    }

    /**
     * Console log errors.
     *
     * @param error
     */
    handleError(error) {
        console.log(`An error occurred: ${error}`);
    }

};

module.exports = MessageHandler;