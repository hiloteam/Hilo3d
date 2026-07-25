import type { NodePointerEvent } from '../core/Node';
import Text2D, { type Text2DStyle } from './Text2D';
import SlicedSprite, { type SlicedSpriteInsets, type SlicedSpriteParameters } from './SlicedSprite';
import type SpriteFrame from './SpriteFrame';

export type UiButtonState = 'up' | 'hover' | 'down' | 'disabled';

export interface UiButtonFrames {
    /** Default button frame. */
    up: SpriteFrame;
    /** Pointer-hover frame. Defaults to `up`. */
    hover?: SpriteFrame;
    /** Pressed frame. Defaults to `hover`. */
    down?: SpriteFrame;
    /** Disabled frame. Defaults to `up`. */
    disabled?: SpriteFrame;
}

export interface UiButtonParameters extends Omit<SlicedSpriteParameters, 'frame' | 'texture'> {
    /** Per-state nine-slice atlas frames. */
    frames: UiButtonFrames;
    /** Optional centered label. */
    label?: string;
    /** Canvas text style for the label. */
    labelStyle?: Text2DStyle;
    /** Initial enabled state. Defaults to `true`. */
    enabled?: boolean;
}

/**
 * Nine-slice game UI button with hover, press, disabled, label, and click event support.
 *
 * Applications enable the desired pointer event types once through `Stage.enableDOMEvent()`.
 */
class UiButton extends SlicedSprite {
    static override readonly typeName: string = 'UiButton';
    readonly isUiButton = true;
    override className = 'UiButton';
    readonly label: Text2D;
    readonly frames: Readonly<UiButtonFrames>;
    private enabledValue: boolean;
    private stateValue: UiButtonState = 'up';

    constructor(params: UiButtonParameters) {
        const { frames, label = '', labelStyle, enabled = true, ...slicedParameters } = params;
        super({
            ...slicedParameters,
            frame: frames.up,
            useHandCursor: slicedParameters.useHandCursor ?? true
        });
        this.frames = Object.freeze({ ...frames });
        this.enabledValue = enabled;
        this.label = new Text2D({
            text: label,
            ...(labelStyle === undefined ? {} : { style: labelStyle }),
            x: this.width * 0.5 - this.anchorX * this.width,
            y: this.height * 0.5 - this.anchorY * this.height,
            anchorX: 0.5,
            anchorY: 0.5,
            ...(params.layer === undefined ? {} : { layer: params.layer }),
            ...(params.sortingLayer === undefined ? {} : { sortingLayer: params.sortingLayer }),
            zIndex: (params.zIndex ?? 0) + 1,
            pointerEnabled: false
        }).addTo(this);
        this.on('pointerover', this.handlePointerOver);
        this.on('pointerout', this.handlePointerOut);
        this.on('pointerdown', this.handlePointerDown);
        this.on('pointerup', this.handlePointerUp);
        this.pointerEnabled = enabled;
        for (const part of this.parts) part.pointerEnabled = enabled;
        this.updateState(enabled ? 'up' : 'disabled');
    }

    /** Whether pointer interaction is enabled. */
    get enabled(): boolean {
        return this.enabledValue;
    }

    /** Current visual state. */
    get state(): UiButtonState {
        return this.stateValue;
    }

    /** Enable or disable interaction and update the visual frame. */
    setEnabled(enabled: boolean): this {
        if (enabled === this.enabledValue) return this;
        this.enabledValue = enabled;
        this.pointerEnabled = enabled;
        for (const part of this.parts) part.pointerEnabled = enabled;
        this.updateState(enabled ? 'up' : 'disabled');
        return this;
    }

    /** Replace the centered label text. */
    setLabel(text: string): this {
        this.label.setText(text);
        return this;
    }

    override setSize(width: number, height: number): this {
        super.setSize(width, height);
        this.label.setPosition(
            this.width * 0.5 - this.anchorX * this.width,
            this.height * 0.5 - this.anchorY * this.height,
            0
        );
        return this;
    }

    private readonly handlePointerOver = (_event: NodePointerEvent): void => {
        if (this.enabledValue) this.updateState('hover');
    };

    private readonly handlePointerOut = (_event: NodePointerEvent): void => {
        if (this.enabledValue) this.updateState('up');
    };

    private readonly handlePointerDown = (_event: NodePointerEvent): void => {
        if (this.enabledValue) this.updateState('down');
    };

    private readonly handlePointerUp = (_event: NodePointerEvent): void => {
        if (this.enabledValue) this.updateState('hover');
    };

    private updateState(state: UiButtonState): void {
        if (state === this.stateValue) return;
        this.stateValue = state;
        const frame =
            state === 'disabled'
                ? (this.frames.disabled ?? this.frames.up)
                : state === 'down'
                  ? (this.frames.down ?? this.frames.hover ?? this.frames.up)
                  : state === 'hover'
                    ? (this.frames.hover ?? this.frames.up)
                    : this.frames.up;
        this.setFrame(frame);
    }
}

export type { SlicedSpriteInsets };
export default UiButton;
