// eslint-disable-next-line
import { ipcRenderer, remote } from 'electron';
import { EventEmitter } from 'events';
import GoogleAssistant from 'google-assistant';

import Configuration from '@/config';

import Commands from '@/commands';

import Player from './player';
import Microphone from './microphone';

export default class Assistant extends EventEmitter {
	constructor() {
		super();

		/** Audio player for Google Assistant responses */
		this.player = new Player();

		/** Microphone class build to transform the browser microphone to an output that's ready for google. */
		this.microphone = new Microphone(Configuration.assistant.audio.sampleRateIn);

		/** Processor for commands */
		this.commands = new Commands();

		/** The assistant library we use to process everything and connect to Google */
		this.assistant = undefined;

		this.responseWindow = undefined;

		this.conversation = undefined;

		ipcRenderer.on('message', (event, message) => {
			console.log('Message from childeren:', message, event);
			if (message.query) {
				this.assist(message.query.queryText);
			}
		});

		this.startConversation = (conversation) => {
			if (Configuration.assistant.textQuery === undefined) {
				this.emit('listening');
				this.microphone.enabled = true;
			}

			conversation.on('audio-data', (data) => {
				// console.log('incoming audio buffer...', data);
				this.player.appendBuffer(Buffer.from(data));
			});

			conversation.on('end-of-utterance', () => {
				this.microphone.enabled = false;
			});

			conversation.on('device-action', (data) => {
				console.log('Device action: ', data);
			});

			conversation.on('transcription', ({ transcription, done }) => {
				console.log('Transcription: ', transcription, done);
			});

			conversation.on('response', (text) => {
				console.log('Response: ', text);
			});

			conversation.on('screen-data', (data) => {
				switch (data.format) {
				case 'HTML':
					this.updateResponseWindow(data.data.toString());
					break;
				default:
					console.log('Error: unknown data format.');
				}
			});

			conversation.on('ended', (error = undefined, followUp = false) => {
				if (followUp && !Configuration.assistant.textQuery) {
					this.assist();
				}

				if (error) {
					console.log('Conversation error', error);
				}

				this.emit('ready');
			});

			this.conversation = conversation;
		};

		/** Registers if we need to follow on the input we've given */
		this.followOn = false;

		/** Store if current action is a command */
		this.command = false;

		this.player.on('ready', () => console.log('Audio player ready...'));

		this.microphone.on('data', (data) => {
			const buffer = Buffer.from(data);
			if (this.conversation) {
				this.conversation.write(buffer);
			}
		});

		this.microphone.on('ready', () => console.log('Microphone ready...'));

		/** Registering events for registered services */
	}

	/** Triggers when the audio player has stopped playing audio. */
	onAssistantFinishedTalking() {
		console.log('Google Assistant audio stopped.');
		if (this.followOn) {
			console.log('Follow on required.');
			this.followOn = false;
			this.reset();
		}
	}

	updateResponseWindow(html) {
		this.emit('responseHtml', html);
	}

	/** Stops the assistant and starts directly a new assist / conversation */
	reset() {
		this.stop();
		this.assist();
	}

	/**
	 * Let's the Google Assistant say a given sentence.
	 *
	 * @param string sentence
	 * @param int Delay in seconds
	 */
	say(sentence, delay = 0, silent = false) {
		setTimeout(() => {
			this.stopConversation();
			if (sentence) {
				if (!silent) {
					this.assist(`repeat after me ${sentence}`);
				} else {
					this.emit('ready');
				}
			}
		}, 1000 * delay);
	}

	playPing() {
		this.player.playPing();
	}

	/**
	 * Sends a request to Google Assistant to start audio streaming
	 * or for the text input given in the arguemnt
	 *
	 * @param {*} inputQuery
	 */
	assist(inputQuery = null) {
		if (inputQuery) {
			this.emit('waiting');
			if (!this.runCommand(inputQuery)) {
				Configuration.assistant.textQuery = inputQuery;
				this.assistant.start(Configuration.assistant);
			}
		} else {
			this.emit('loading');
			Configuration.assistant.textQuery = undefined;
			this.assistant.start(Configuration.assistant);
		}
	}

	/**
	 * Run's a command based on the input text query
	 * @param {*} textQuery
	 * @param {*} queueCommand Queue the command when the assistant has ended current converstion.
	 */
	runCommand(textQuery, queueCommand = false) {
		console.log('Checking if"', textQuery, '"is a command.');
		const command = this.commands.findCommand(textQuery);
		if (command) {
			console.log('Command found.', command);
			this.command = command;
			if (!queueCommand) {
				console.log('executing command directly.');
				if (Commands.run(this.command)) {
					console.log('executing command done.');
					this.emit('ready');
				}
			} else {
				console.log('executing command after session.');
				this.assistant.once('end', () => {
					console.log('ready for command...');
					if (Commands.run(this.command)) {
						console.log('command finished!');
						this.emit('ready');
					}
				});
				this.forceStop();
			}
			return true;
		}
		console.log('no command found.');
		return false;
	}

	/** Stops the microphone output and plays what's left in the buffer (if any) */
	stopConversation(forceStop = false) {
		if (this.converation) {
			this.conversation.stop();
			if (forceStop) {
				this.player.reset();
				this.microphone.enabled = false;
				return;
			}
			this.player.play();
		}
	}

	/**
	 * Sets up the Google Assistant for Electron.
	 * @param {*} OAuth2Client
	 */
	authenticate() {
		this.assistant = new GoogleAssistant(Configuration.auth);
		this.assistant.on('ready', () => {
			this.emit('ready');
		});

		this.assistant.on('error', (error) => {
			console.log('Assistant Error:', error);
		});

		this.assistant.on('started', this.startConversation);
	}
}
