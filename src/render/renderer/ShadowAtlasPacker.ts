interface Rectangle {
    width: number;
    height: number;
    x: number;
    y: number;
    index: number;
}

interface Shelf {
    y: number;
    height: number;
    used: number;
    count: number;
}

function rectangleOrder(left: Rectangle, right: Rectangle): number {
    return right.height - left.height || right.width - left.width || left.index - right.index;
}

/** Deterministic staged packing; storage grows only with the slice high-water mark. */
export class ShadowAtlasPacker {
    readonly rectangles: Rectangle[] = [];
    readonly #ordered: Rectangle[] = [];
    readonly #shelves: Shelf[] = [];
    readonly #widths = new Set<number>();
    #count = 0;
    #changed = false;
    #valid = false;
    #lastCount = 0;
    #lastMaximum = 0;
    width = 0;
    height = 0;
    columns = 0;
    rows = 0;
    capacity = 0;

    reset(): void {
        this.#count = 0;
        this.#changed = false;
    }

    add(width: number, height: number): void {
        let rectangle = this.rectangles[this.#count];
        if (rectangle === undefined) {
            rectangle = { width, height, x: 0, y: 0, index: this.#count };
            this.rectangles.push(rectangle);
        }
        this.#changed ||= rectangle.width !== width || rectangle.height !== height;
        rectangle.width = width;
        rectangle.height = height;
        this.#ordered[this.#count] = rectangle;
        this.#count++;
    }

    pack(maximumDimension: number): void {
        this.#ordered.length = this.#count;
        if (
            this.#valid &&
            !this.#changed &&
            this.#lastCount === this.#count &&
            this.#lastMaximum === maximumDimension
        )
            return;
        this.#valid = false;
        if (this.#count === 0) {
            this.width = this.height = this.columns = this.rows = this.capacity = 0;
            this.remember(maximumDimension);
            return;
        }
        const first = this.#ordered[0];
        if (first === undefined) throw new Error('Shadow packing input is incomplete');
        let uniform = true;
        let maximumWidth = 0;
        let area = 0;
        for (const rectangle of this.#ordered) {
            if (rectangle.width > maximumDimension || rectangle.height > maximumDimension) {
                throw new RangeError(
                    `Shadow atlas exceeds maxTextureDimension2D ${String(maximumDimension)}`
                );
            }
            uniform &&= rectangle.width === first.width && rectangle.height === first.height;
            maximumWidth = Math.max(maximumWidth, rectangle.width);
            area += rectangle.width * rectangle.height;
        }
        const columns = Math.ceil(Math.sqrt(this.#count));
        const rows = Math.ceil(this.#count / columns);
        if (
            uniform &&
            columns * first.width <= maximumDimension &&
            rows * first.height <= maximumDimension
        ) {
            this.width = columns * first.width;
            this.height = rows * first.height;
            this.columns = columns;
            this.rows = rows;
            this.capacity = columns * rows;
            for (const rectangle of this.#ordered) {
                rectangle.x = (rectangle.index % columns) * first.width;
                rectangle.y = Math.floor(rectangle.index / columns) * first.height;
            }
            this.remember(maximumDimension);
            return;
        }

        this.#ordered.sort(rectangleOrder);
        this.#widths.clear();
        this.#widths.add(maximumWidth);
        this.#widths.add(
            Math.min(maximumDimension, Math.max(maximumWidth, Math.ceil(Math.sqrt(area))))
        );
        this.#widths.add(maximumDimension);
        let prefixWidth = 0;
        for (let index = 0; index < this.#count; index++) {
            prefixWidth += this.#ordered[index]?.width ?? 0;
            if (prefixWidth <= maximumDimension) this.#widths.add(prefixWidth);
            if ((index + 1) * maximumWidth <= maximumDimension)
                this.#widths.add((index + 1) * maximumWidth);
        }
        let selectedWidth = 0;
        let bestArea = Infinity;
        let bestEdge = Infinity;
        for (const width of this.#widths) {
            if (!this.place(width, maximumDimension, false)) continue;
            const packedArea = this.width * this.height;
            const edge = Math.max(this.width, this.height);
            if (packedArea < bestArea || (packedArea === bestArea && edge < bestEdge)) {
                bestArea = packedArea;
                bestEdge = edge;
                selectedWidth = width;
            }
        }
        if (selectedWidth === 0) {
            throw new RangeError(
                `Shadow atlas exceeds maxTextureDimension2D ${String(maximumDimension)}`
            );
        }
        this.place(selectedWidth, maximumDimension, true);
        this.capacity = this.#count;
        this.remember(maximumDimension);
    }

    private remember(maximumDimension: number): void {
        this.#lastCount = this.#count;
        this.#lastMaximum = maximumDimension;
        this.#valid = true;
    }

    private place(width: number, maximumDimension: number, write: boolean): boolean {
        let shelfCount = 0;
        this.width = this.height = this.columns = 0;
        for (const rectangle of this.#ordered) {
            let selected: Shelf | undefined;
            for (let index = 0; index < shelfCount; index++) {
                const shelf = this.#shelves[index];
                if (
                    shelf !== undefined &&
                    shelf.height >= rectangle.height &&
                    shelf.used + rectangle.width <= width
                ) {
                    selected = shelf;
                    break;
                }
            }
            if (selected === undefined) {
                if (this.height + rectangle.height > maximumDimension) return false;
                selected = this.#shelves[shelfCount];
                if (selected === undefined) {
                    selected = { y: 0, height: 0, used: 0, count: 0 };
                    this.#shelves[shelfCount] = selected;
                }
                selected.y = this.height;
                selected.height = rectangle.height;
                selected.used = selected.count = 0;
                this.height += rectangle.height;
                shelfCount++;
            }
            if (write) {
                rectangle.x = selected.used;
                rectangle.y = selected.y;
            }
            selected.used += rectangle.width;
            selected.count++;
            this.width = Math.max(this.width, selected.used);
            this.columns = Math.max(this.columns, selected.count);
        }
        this.rows = shelfCount;
        return true;
    }
}
