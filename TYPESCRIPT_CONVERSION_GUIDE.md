# TypeScript Conversion Guide

This guide documents the pattern for converting Hilo3d classes from JavaScript `Class.create()` pattern to native TypeScript classes.

## Conversion Pattern

### Before (JavaScript with Class.create)
```javascript
import Class from '../core/Class';

const MyClass = Class.create({
    constructor(param) {
        this.value = param || 0;
        this._privateValue = 0;
    },
    
    _privateValue: 0,
    value: 0,
    
    someProperty: {
        get() {
            return this._privateValue;
        },
        set(v) {
            this._privateValue = v;
        }
    },
    
    publicMethod() {
        return this.value;
    },
    
    _privateMethod() {
        // implementation
    }
});

export default MyClass;
```

### After (TypeScript class)
```typescript
class MyClass {
    private _privateValue: number = 0;
    value: number = 0;

    constructor(param?: number) {
        this.value = param || 0;
        this._privateValue = 0;
    }
    
    get someProperty(): number {
        return this._privateValue;
    }
    
    set someProperty(v: number) {
        this._privateValue = v;
    }
    
    publicMethod(): number {
        return this.value;
    }
    
    private _privateMethod(): void {
        // implementation
    }
}

export default MyClass;
```

## Key Conversion Steps

1. **Replace Class.create with class declaration**
   - Remove `import Class from '../core/Class'`
   - Replace `const MyClass = Class.create({...})` with `class MyClass {...}`

2. **Add type annotations**
   - Add parameter types: `(param)` → `(param: number)`
   - Add return types: `method()` → `method(): ReturnType`
   - Add property types: `value: 0` → `value: number = 0`

3. **Convert properties with getters/setters**
   ```javascript
   // Before
   someProperty: {
       get() { return this._value; },
       set(v) { this._value = v; }
   }
   
   // After
   get someProperty(): Type {
       return this._value;
   }
   set someProperty(v: Type) {
       this._value = v;
   }
   ```

4. **Mark private members**
   - Prefix with `private` keyword
   - Members starting with `_` are typically private

5. **Handle inheritance**
   ```javascript
   // Before
   const ChildClass = Class.create({
       Extends: ParentClass,
       constructor(params) {
           ChildClass.superclass.constructor.call(this, params);
       }
   });
   
   // After
   class ChildClass extends ParentClass {
       constructor(params: ParamsType) {
           super(params);
       }
   }
   ```

6. **Handle mixins**
   ```javascript
   // Before
   const MyClass = Class.create({
       Mixes: EventMixin,
       // ...
   });
   
   // After (option 1: interface)
   class MyClass implements EventMixin {
       // Implement mixin methods
   }
   
   // After (option 2: composition)
   class MyClass {
       private events = new EventEmitter();
       // Delegate to composition object
   }
   ```

## Examples of Converted Classes

### Cache (Simple utility class with generics)
```typescript
class Cache<T = any> {
    private _cache: Record<string, T> = {};
    
    get(id: string): T | undefined {
        return this._cache[id];
    }
    
    add(id: string, obj: T): void {
        this._cache[id] = obj;
    }
}
```

### Ticker (Class with getters/setters)
```typescript
interface TickObject {
    tick(deltaTime: number): void;
}

class Ticker {
    private _targetFPS: number = 0;
    private _tickers: TickObject[] = [];
    
    get targetFPS(): number {
        return this._targetFPS;
    }
    
    set targetFPS(value: number) {
        this._targetFPS = value;
    }
    
    addTick(tickObject: TickObject): void {
        this._tickers.push(tickObject);
    }
}
```

## Common Type Definitions

```typescript
// TypedArray types
type TypedArray =
    | Int8Array
    | Uint8Array
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

type TypedArrayConstructor =
    | Int8ArrayConstructor
    | Uint8ArrayConstructor
    | Int16ArrayConstructor
    | Uint16ArrayConstructor
    | Int32ArrayConstructor
    | Uint32ArrayConstructor
    | Float32ArrayConstructor
    | Float64ArrayConstructor;

// Common interfaces
interface Cacheable {
    __cacheId?: string;
}
```

## Completed Conversions

- ✅ `src/utils/Cache.ts` - Generic utility class
- ✅ `src/utils/log.ts` - Namespace object with rest parameters
- ✅ `src/utils/bufferUtil.ts` - Utility object with typed methods
- ✅ `src/utils/Ticker.ts` - Class with interfaces and getters/setters

## Todo

See main plan in PR description for full list of classes to convert.

## Notes

- Keep JSDoc comments for documentation generation
- Use `any` sparingly - prefer specific types or generics
- Optional parameters use `?` or default values
- Arrays should be typed: `number[]` or `Array<number>`
- Use `void` for functions with no return value
- Use `undefined` instead of `null` where appropriate
