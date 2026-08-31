let cadQueue: Promise<void> = Promise.resolve();

export function serializeCadWork<T>(work: () => Promise<T>): Promise<T> {
	const result = cadQueue.then(work, work);
	cadQueue = result.then(() => undefined, () => undefined);
	return result;
}
