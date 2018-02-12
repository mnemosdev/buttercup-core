const VError = require("verror");
const AsyncEventEmitter = require("../events/AsyncEventEmitter.js");
const MemoryStorageInterface = require("../storage/MemoryStorageInterface.js");
const ArchiveSource = require("./ArchiveSource.js");

const STORAGE_KEY_PREFIX = "bcup_archivemgr_";
const STORAGE_KEY_PREFIX_TEST = /^bcup_archivemgr_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

class ArchiveManager extends AsyncEventEmitter {
    constructor(storageInterface = new MemoryStorageInterface()) {
        super();
        this._storageInterface = storageInterface;
        this._sources = [];
    }

    get sources() {
        return this._sources;
    }

    get sourcesList() {
        return this.sources.map(source => source.description);
    }

    get storageInterface() {
        return this._storageInterface;
    }

    get unlockedSources() {
        return this.sources.filter(source => source.status === ArchiveSource.Status.UNLOCKED);
    }

    addSource(archiveSource, emitUpdated = true) {
        const existing = this.sources.find(source => source.id === archiveSource.id);
        if (!existing) {
            this.sources.push(archiveSource);
            if (emitUpdated) {
                this._emitSourcesListUpdated();
            }
            const handleDetailsChange = (event, sourceDetails) => {
                this.emit(event, sourceDetails);
                this._emitSourcesListUpdated();
            };
            archiveSource.on("sourceLocked", details => handleDetailsChange("sourceLocked", details));
            archiveSource.on("sourceUnlocked", details => handleDetailsChange("sourceUnlocked", details));
            archiveSource.on("sourceColourUpdated", details => handleDetailsChange("sourceColourUpdated", details));
            this.reorderSources();
        }
    }

    dehydrate() {
        return Promise.all(
            this.sources.map(source =>
                source.dehydrate().then(dehydratedSource => {
                    this.storageInterface.setValue(`${STORAGE_KEY_PREFIX}${source.id}`, dehydratedSource);
                })
            )
        );
    }

    getSourceForID(sourceID) {
        const source = this.sources.find(target => target.id && target.id === sourceID);
        return source || null;
    }

    rehydrate() {
        return this.storageInterface
            .getAllKeys()
            .then(keys =>
                Promise.all(
                    keys.filter(key => STORAGE_KEY_PREFIX_TEST.test(key)).map(key =>
                        this.storageInterface
                            .getValue(key)
                            .then(dehydratedSource => ArchiveSource.rehydrate(dehydratedSource))
                            .then(source => {
                                this.addSource(source, /* emit updated event: */ false);
                            })
                            .catch(function __handleDehydratedReadError(err) {
                                throw new VError(err, `Failed rehydrating item from storage with key: ${key}`);
                            })
                    )
                )
            )
            .then(() => {
                // Emit updated event after all added
                this._emitSourcesListUpdated();
            })
            .catch(err => {
                // Or after all failed
                this._emitSourcesListUpdated();
                throw new VError(err, "Failed rehydrating sources");
            });
    }

    removeSource(sourceID) {
        const sourceIndex = this.sources.findIndex(source => source.id === sourceID);
        if (sourceIndex === -1) {
            throw new VError(`Failed removing source: No source found for ID: ${sourceID}`);
        }
        const source = this.sources[sourceIndex];
        source.removeAllListeners();
        this.sources.splice(sourceIndex, 1);
        this._emitSourcesListUpdated();
    }

    reorderSource(sourceID, position) {
        const source = getSourceForID(sourceID);
        if (!source) {
            throw new VError(`Failed reordering source: No source found for ID: ${sourceID}`);
        }
        source.order = position;
        this.sources.forEach(otherSource => {
            if (otherSource.id !== sourceID && otherSource.order >= position) {
                otherSource.order += 1;
            }
        });
        this.reorderSources();
    }

    reorderSources() {
        this.sources.sort((sourceA, sourceB) => {
            if (sourceA.order > sourceB.order) {
                return -1;
            } else if (sourceB.order > sourceA.order) {
                return 1;
            }
            return 0;
        });
        this.sources.forEach((source, index) => {
            source.order = index;
        });
        this._emitSourcesListUpdated();
    }

    _emitSourcesListUpdated() {
        this.emit("sourcesUpdated", this.sourcesList);
    }
}

module.exports = ArchiveManager;
