import {ListRow} from './list-row';
import {DataModel} from '../../core/database/storage/data-model';
import {CraftAddition} from './craft-addition';
import {GarlandToolsService} from '../../core/api/garland-tools.service';
import {I18nToolsService} from '../../core/tools/i18n-tools.service';
import {MathTools} from 'app/tools/math-tools';
import * as semver from 'semver';
import {ListTag} from './list-tag.enum';

declare const ga: Function;

export class List extends DataModel {
    name: string;
    recipes: ListRow[] = [];
    preCrafts: ListRow[] = [];
    gathers: ListRow[] = [];
    others: ListRow[] = [];
    crystals: ListRow[] = [];

    note = '';

    // noinspection JSUnusedGlobalSymbols
    createdAt: string = new Date().toISOString();

    version: string;

    authorId: string;

    favorites: string[] = [];

    tags: ListTag[] = [];

    public: boolean;

    constructor() {
        super();
    }

    public clone(): List {
        const clone = new List();
        for (const prop of Object.keys(this)) {
            if (['recipes', 'preCrafts', 'gathers', 'others', 'crystals', 'note'].indexOf(prop) > -1) {
                clone[prop] = this[prop];
            }
        }
        clone.name = this.name;
        clone.version = this.version || '1.0.0';
        delete clone.$key;
        ga('send', 'event', 'List', 'creation');
        ga('send', 'event', 'List', 'clone');
        return clone;
    }

    public forEachItem(method: (arg: ListRow) => void): void {
        (this.others || []).forEach(method);
        (this.gathers || []).forEach(method);
        (this.preCrafts || []).forEach(method);
    }

    public forEach(method: (arg: ListRow) => void): void {
        (this.crystals || []).forEach(method);
        (this.others || []).forEach(method);
        (this.gathers || []).forEach(method);
        (this.preCrafts || []).forEach(method);
        (this.recipes || []).forEach(method);
    }

    public addToRecipes(data: ListRow): number {
        return this.add(this.recipes, data, true);
    }

    public addToPreCrafts(data: ListRow): number {
        return this.add(this.preCrafts, data);
    }

    public addToGathers(data: ListRow): number {
        return this.add(this.gathers, data);
    }

    public addToOthers(data: ListRow): number {
        return this.add(this.others, data);
    }

    public addToCrystals(data: ListRow): number {
        return this.add(this.crystals, data);
    }

    /**
     * Merges the list with another one, used for list additions to me more efficient.
     * @param {List} otherList
     * @returns {List}
     */
    public merge(otherList: List): List {
        otherList.crystals.forEach(crystal => {
            this.add(this.crystals, crystal);
        });
        otherList.gathers.forEach(gather => {
            this.add(this.gathers, gather);
        });
        otherList.others.forEach(other => {
            this.add(this.others, other);
        });
        otherList.preCrafts.forEach(preCraft => {
            this.add(this.preCrafts, preCraft, true);
        });
        otherList.recipes.forEach(recipe => {
            this.add(this.recipes, recipe, true);
        });
        return this;
    }

    private add(array: ListRow[], data: ListRow, recipe = false): number {
        let previousAmount = 0;
        let row = array.find(r => {
            return r.id === data.id;
        });
        if (row === undefined) {
            array.push(data);
            row = array[array.length - 1];
        } else {
            row.amount = MathTools.round(row.amount + data.amount);
            previousAmount = row.amount_needed;
        }
        row.amount_needed = MathTools.absoluteCeil(row.amount / row.yield);
        const added = row.amount_needed - previousAmount;
        if (added < 0 && recipe) {
            const previousDone = row.done;
            if (previousDone > row.amount_needed) {
                this.setDone(row, row.amount_needed - previousDone);
            }
        }
        return added;
    }

    public clean(): List {
        for (const prop of Object.keys(this)) {
            if (['recipes', 'preCrafts', 'gathers', 'others', 'crystals'].indexOf(prop) > -1) {
                this[prop] = this[prop].filter(row => row.amount > 0);
            }
        }
        return this;
    }

    public isLarge(): boolean {
        let items = 0;
        this.forEach(() => {
            items++;
        });
        return items > 100;
    }

    public isEmpty(): boolean {
        return this.recipes.length === 0 &&
            this.preCrafts.length === 0 &&
            this.gathers.length === 0 &&
            this.others.length === 0 &&
            this.crystals.length === 0;
    }

    public getItemById(id: number, excludeRecipes: boolean = false): ListRow {
        for (const array of Object.keys(this).filter(key => excludeRecipes ? key !== 'recipes' : true)) {
            for (const row of this[array]) {
                if (row.id === id) {
                    return row;
                }
            }
        }
        return undefined;
    }

    /**
     * Adds items to a given row and tags them as used if they're "done" from another craft.
     *
     * For instance, if you already have Iron ingots, you'll check them into the list, and it'll check the ores needed for the craft,
     * it will also mark them as used as you aren't supposed to have them in your inventory as you used them for the craft.
     *
     * @param {ListRow} pitem
     * @param {number} amount
     * @param {boolean} setUsed
     * @param {boolean} excludeRecipes
     */
    public setDone(pitem: ListRow, amount: number, excludeRecipes = false, setUsed = false): void {
        const item = this.getItemById(pitem.id, excludeRecipes);
        item.done += amount;
        if (item.done > item.amount) {
            item.done = item.amount;
        }
        if (item.done < 0) {
            item.done = 0;
        }
        if (setUsed) {
            item.used += amount;
            if (item.used > item.amount) {
                item.used = item.amount;
            }
            if (item.used < 0) {
                item.used = 0;
            }
        }
        amount = MathTools.absoluteCeil(amount / pitem.yield);
        if (item.requires !== undefined) {
            for (const requirement of item.requires) {
                const requirementItem = this.getItemById(requirement.id, excludeRecipes);
                if (requirementItem !== undefined) {
                    let nextAmount = requirement.amount * amount;
                    // If this is not a precraft, we have to take yields in consideration.
                    if (requirementItem.requires === undefined) {
                        nextAmount = MathTools.absoluteCeil(nextAmount / requirementItem.yield);
                    }
                    this.setDone(requirementItem, nextAmount, true, true);
                }
            }
        }
    }

    canBeCrafted(item: ListRow): boolean {
        if (item.craftedBy === undefined || item.craftedBy.length === 0 || item.requires === undefined) {
            return false;
        }
        let canCraft = true;
        for (const requirement of item.requires) {
            // If the requirement is a crystal, don't mind it.
            if (requirement.id < 20 && requirement.id > 1) {
                continue;
            }
            const requirementItem = this.getItemById(requirement.id, true);
            // While each requirement has enough items remaining, you can craft the item.
            // If only one misses, then this will turn false for the rest of the loop
            canCraft = canCraft && (requirementItem.done - requirementItem.used) >= requirement.amount * item.amount_needed;
        }
        return canCraft;
    }

    /**
     * Checks if the list is outdated, the implementation is meant to change.
     * @returns {boolean}
     */
    public isOutDated(): boolean {
        if (this.isEmpty()) {
            return false;
        }
        let res = false;
        this.forEachItem(i => {
            res = res || (i.amount_needed === undefined);
            if (i.gatheredBy !== undefined) {
                res = res || (i.gatheredBy.type === undefined);
            }
        });
        res = res || (this.version === undefined);
        res = res || semver.ltr(this.version, '2.3.0');
        return res;
    }

    public resetDone(item: ListRow): void {
        item.done = 0;
        item.used = 0;
        if (item.requires !== undefined) {
            item.requires.forEach(requirement => {
                const requirementItem = this.getItemById(requirement.id, true);
                this.resetDone(requirementItem);
            });
        }
    }

    public addCraft(additions: CraftAddition[], gt: GarlandToolsService, i18n: I18nToolsService): List {
        const nextIteration: CraftAddition[] = [];
        for (const addition of additions) {
            for (const element of addition.item.craft[0].ingredients) {
                // If this is a crystal
                if (element.id < 20 && element.id > 1) {
                    const crystal = gt.getCrystalDetails(element.id);
                    this.addToCrystals({
                        id: element.id,
                        icon: crystal.icon,
                        amount: element.amount * addition.amount,
                        done: 0,
                        used: 0,
                        yield: 1
                    });
                } else {
                    const elementDetails = addition.data.getIngredient(element.id);
                    if (elementDetails.isCraft()) {
                        const yields = elementDetails.craft[0].yield || 1;
                        const added = this.addToPreCrafts({
                            id: elementDetails.id,
                            icon: elementDetails.icon,
                            amount: element.amount * addition.amount,
                            requires: elementDetails.craft[0].ingredients,
                            done: 0,
                            used: 0,
                            yield: yields
                        });
                        nextIteration.push({
                            item: elementDetails,
                            data: addition.data,
                            amount: added
                        });
                    } else if (elementDetails.hasNodes() || elementDetails.hasFishingSpots()) {
                        this.addToGathers({
                            id: elementDetails.id,
                            icon: elementDetails.icon,
                            amount: element.amount * addition.amount,
                            done: 0,
                            used: 0,
                            yield: 1
                        });
                    } else {
                        this.addToOthers({
                            id: elementDetails.id,
                            icon: elementDetails.icon,
                            amount: element.amount * addition.amount,
                            done: 0,
                            used: 0,
                            yield: 1
                        });
                    }
                }
            }
        }
        if (nextIteration.length > 0) {
            return this.addCraft(nextIteration, gt, i18n);
        }
        return this;
    }
}
