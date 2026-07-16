export interface SelfHostedSettings {
	url: string;
	username: string;
	passwordSecretId?: string;
	/** Legacy in-memory compatibility only; current settings never persist this field. */
	password?: string;
}
