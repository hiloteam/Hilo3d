import ts from 'typescript';

export interface ShaderModernityViolation {
    readonly label: string;
    readonly line: number;
}

interface SourceLiteral {
    readonly node: ts.Node;
    readonly text: string;
    readonly offset: number;
}

const shaderGuardFixturePath = 'test/spec/shader/ShaderModernityGuardrails.test.ts';
const shaderGuardImplementationPath = 'scripts/shader-modernity.ts';
const storageGraphicsBoundaryImplementationPath = 'src/render/compute/StorageGraphicsShader.ts';
const controlledStorageGraphicsChunkPaths: ReadonlySet<string> = new Set([
    'src/shader/chunk/clusteredForward.frag',
    'src/shader/chunk/dynamicGlobalIllumination.frag'
]);
const controlledComputeFixturePaths: ReadonlySet<string> = new Set([
    'test/spec/renderer/ComputeKernel.test.ts',
    'test/spec/renderer/ComputePipelineResourceCache.test.ts',
    'test/spec/renderer/ComputeRenderPass.test.ts',
    'test/spec/renderer/ComputeShader.test.ts',
    'test/spec/renderer/ScriptableComputeDispatch.test.ts',
    'test/spec/renderer/ScriptableRenderPipeline.test.ts',
    'test/spec/renderer/WgslComputeCompiler.test.ts',
    'test/spec/rhi/portable/RHIComputeContract.test.ts',
    'test/spec/rhi/portable/WebGPUBackend.native.test.ts'
]);
const compilerNegativeFixturePaths: ReadonlySet<string> = new Set([
    'test/spec/renderer/WgslComputeCompiler.test.ts'
]);
const controlledStorageGraphicsFixturePaths: ReadonlySet<string> = new Set([
    'test/spec/renderer/GPUDrivenPipelineResourceCache.test.ts',
    'test/spec/renderer/StorageGraphicsShader.test.ts',
    'test/spec/renderer/StorageGraphicsShaderCompiler.test.ts'
]);

const wgslComputePattern = /@compute\b/u;
const wgslVertexPattern = /@vertex\b/u;
const wgslFragmentPattern = /@fragment\b/u;
const glslVersionPattern = /^\s*#\s*version\s+([0-9]+)\s+([A-Za-z]+)\b/u;
const glsl310Pattern = /^\s*#\s*version\s+310\s+es\b/u;
const glslStorageBlockPattern =
    /\blayout\s*\(([^)]*)\)\s*(readonly\s+)?buffer\s+[A-Za-z_]\w*\s*\{/gu;
const glslLooseStorageBlockPattern = /\b(?:readonly\s+)?buffer\s+[A-Za-z_]\w*\s*\{/u;
const glslLooseStorageBlockGlobalPattern = /\b(?:readonly\s+)?buffer\s+[A-Za-z_]\w*\s*\{/gu;
const glslComputeDialectPattern =
    /(?:\blayout\s*\([^)]*\blocal_size_[xyz]\s*=|\bgl_(?:GlobalInvocationID|LocalInvocationID|LocalInvocationIndex|WorkGroupID|NumWorkGroups)\b|\bshared\s+[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*(?:\[|=|;)|\b(?:barrier|memoryBarrierShared|groupMemoryBarrier)\s*\()/u;

function constructorName(expression: ts.Expression): string | null {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

function propertyName(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
    if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isTypeAssertionExpression(expression)
    ) {
        return unwrapExpression(expression.expression);
    }
    return expression;
}

function collectSourceLiterals(sourceFile: ts.SourceFile): readonly SourceLiteral[] {
    const literals: SourceLiteral[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            literals.push({ node, text: node.text, offset: node.getStart(sourceFile) });
            return;
        }
        if (ts.isTemplateExpression(node)) {
            literals.push({
                node,
                text: node.getText(sourceFile).slice(1, -1),
                offset: node.getStart(sourceFile)
            });
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return literals;
}

function collectVariableDeclarations(
    sourceFile: ts.SourceFile
): ReadonlyMap<string, ts.VariableDeclaration> {
    const declarations = new Map<string, ts.VariableDeclaration>();
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            declarations.set(node.name.text, node);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return declarations;
}

function resolveObjectLiteral(
    expression: ts.Expression,
    declarations: ReadonlyMap<string, ts.VariableDeclaration>,
    visited: Set<ts.Node>
): ts.ObjectLiteralExpression | null {
    const current = unwrapExpression(expression);
    if (visited.has(current)) return null;
    visited.add(current);
    if (ts.isObjectLiteralExpression(current)) return current;
    if (ts.isIdentifier(current)) {
        const declaration = declarations.get(current.text);
        if (declaration?.initializer) {
            return resolveObjectLiteral(declaration.initializer, declarations, visited);
        }
    }
    return null;
}

function collectExpressionLiterals(
    expression: ts.Expression,
    declarations: ReadonlyMap<string, ts.VariableDeclaration>,
    target: Set<ts.Node>,
    visited: Set<ts.Node>
): void {
    const current = unwrapExpression(expression);
    if (visited.has(current)) return;
    visited.add(current);
    if (
        ts.isStringLiteral(current) ||
        ts.isNoSubstitutionTemplateLiteral(current) ||
        ts.isTemplateExpression(current)
    ) {
        target.add(current);
        return;
    }
    if (ts.isIdentifier(current)) {
        const declaration = declarations.get(current.text);
        if (declaration?.initializer) {
            collectExpressionLiterals(declaration.initializer, declarations, target, visited);
        }
        return;
    }
    const visitChild = (child: ts.Node): void => {
        if (ts.isExpression(child)) {
            collectExpressionLiterals(child, declarations, target, visited);
            return;
        }
        child.forEachChild(visitChild);
    };
    current.forEachChild(visitChild);
}

function staticString(
    expression: ts.Expression,
    declarations: ReadonlyMap<string, ts.VariableDeclaration>,
    visited = new Set<ts.Node>()
): string | null {
    const current = unwrapExpression(expression);
    if (visited.has(current)) return null;
    visited.add(current);
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
        return current.text;
    if (ts.isIdentifier(current)) {
        const initializer = declarations.get(current.text)?.initializer;
        return initializer ? staticString(initializer, declarations, visited) : null;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = staticString(current.left, declarations, new Set(visited));
        const right = staticString(current.right, declarations, new Set(visited));
        return left !== null && right !== null ? left + right : null;
    }
    if (
        ts.isCallExpression(current) &&
        ts.isPropertyAccessExpression(current.expression) &&
        (current.expression.name.text === 'replace' ||
            current.expression.name.text === 'replaceAll')
    ) {
        const [search, replacement] = current.arguments;
        if (!search || !replacement) return null;
        const receiver = staticString(
            current.expression.expression,
            declarations,
            new Set(visited)
        );
        const pattern = staticReplacementSearch(search, declarations, new Set(visited));
        const value = staticString(replacement, declarations, new Set(visited));
        if (receiver === null || receiver.length > 1_048_576 || pattern === null || value === null)
            return null;
        try {
            return current.expression.name.text === 'replaceAll'
                ? receiver.replaceAll(pattern, value)
                : receiver.replace(pattern, value);
        } catch {
            return null;
        }
    }
    return null;
}

function staticReplacementSearch(
    expression: ts.Expression,
    declarations: ReadonlyMap<string, ts.VariableDeclaration>,
    visited = new Set<ts.Node>()
): string | RegExp | null {
    const text = staticString(expression, declarations, new Set(visited));
    if (text !== null) return text;
    const current = unwrapExpression(expression);
    if (visited.has(current)) return null;
    visited.add(current);
    if (ts.isIdentifier(current)) {
        const initializer = declarations.get(current.text)?.initializer;
        return initializer ? staticReplacementSearch(initializer, declarations, visited) : null;
    }
    if (ts.isRegularExpressionLiteral(current)) {
        const end = current.text.lastIndexOf('/');
        try {
            return new RegExp(current.text.slice(1, end), current.text.slice(end + 1));
        } catch {
            return null;
        }
    }
    return null;
}

/** A transformation may inject chunks, but it must not remove or downgrade the inherited header. */
function changesStorageVersion(
    receiver: ts.Expression,
    search: ts.Expression,
    replacement: ts.Expression,
    replaceAll: boolean,
    declarations: ReadonlyMap<string, ts.VariableDeclaration>
): boolean {
    const pattern = staticReplacementSearch(search, declarations);
    if (pattern === null) return false;
    // Preserve the full input for regex anchors/lookarounds. Only unknown receivers such as
    // source.vertexSource use a canonical complete shader probe and retain runtime validation.
    const source = staticString(receiver, declarations) ?? '#version 310 es\nvoid main() {}\n';
    if (!glsl310Pattern.test(source)) return false; // Complete-source validation reports this case.
    const replacementText = staticString(replacement, declarations);
    try {
        const result = replaceAll
            ? source.replaceAll(pattern, replacementText ?? '')
            : source.replace(pattern, replacementText ?? '');
        return !glsl310Pattern.test(result);
    } catch {
        // Non-global replaceAll regexes fail in JavaScript itself; they are not shader dialects.
        return false;
    }
}

function collectStorageExpressionLiterals(
    expression: ts.Expression,
    declarations: ReadonlyMap<string, ts.VariableDeclaration>,
    sources: Set<ts.Node>,
    fragments: Set<ts.Node>,
    versionChanges: Set<ts.Node>,
    transformedSources: Map<ts.Node, string>,
    visited: Set<ts.Node>
): void {
    const current = unwrapExpression(expression);
    if (visited.has(current)) return;
    visited.add(current);
    if (
        ts.isStringLiteral(current) ||
        ts.isNoSubstitutionTemplateLiteral(current) ||
        ts.isTemplateExpression(current)
    ) {
        sources.add(current);
        if (ts.isTemplateExpression(current))
            for (const span of current.templateSpans)
                collectExpressionLiterals(span.expression, declarations, fragments, new Set());
        return;
    }
    if (ts.isIdentifier(current)) {
        const initializer = declarations.get(current.text)?.initializer;
        if (initializer)
            collectStorageExpressionLiterals(
                initializer,
                declarations,
                sources,
                fragments,
                versionChanges,
                transformedSources,
                visited
            );
        return;
    }
    if (ts.isConditionalExpression(current)) {
        collectStorageExpressionLiterals(
            current.whenTrue,
            declarations,
            sources,
            fragments,
            versionChanges,
            transformedSources,
            visited
        );
        collectStorageExpressionLiterals(
            current.whenFalse,
            declarations,
            sources,
            fragments,
            versionChanges,
            transformedSources,
            visited
        );
        return;
    }
    if (
        ts.isCallExpression(current) &&
        ts.isPropertyAccessExpression(current.expression) &&
        (current.expression.name.text === 'replace' ||
            current.expression.name.text === 'replaceAll')
    ) {
        const receiver = current.expression.expression;
        collectStorageExpressionLiterals(
            receiver,
            declarations,
            sources,
            fragments,
            versionChanges,
            transformedSources,
            visited
        );
        for (const argument of current.arguments)
            collectExpressionLiterals(argument, declarations, fragments, new Set());
        const [search, replacement] = current.arguments;
        if (
            search &&
            replacement &&
            changesStorageVersion(
                receiver,
                search,
                replacement,
                current.expression.name.text === 'replaceAll',
                declarations
            )
        )
            versionChanges.add(current);
        const transformed = staticString(current, declarations);
        if (transformed !== null) {
            sources.add(current);
            transformedSources.set(current, transformed);
        }
        return;
    }
    const visitChild = (child: ts.Node): void => {
        if (ts.isExpression(child)) {
            collectStorageExpressionLiterals(
                child,
                declarations,
                sources,
                fragments,
                versionChanges,
                transformedSources,
                visited
            );
            return;
        }
        child.forEachChild(visitChild);
    };
    current.forEachChild(visitChild);
}

function collectNamedPropertyLiterals(
    object: ts.ObjectLiteralExpression,
    property: string,
    declarations: ReadonlyMap<string, ts.VariableDeclaration>,
    target: Set<ts.Node>,
    visitedObjects: Set<ts.Node>,
    storageFragments?: Set<ts.Node>,
    storageVersionChanges?: Set<ts.Node>,
    storageTransformedSources?: Map<ts.Node, string>
): void {
    if (visitedObjects.has(object)) return;
    visitedObjects.add(object);
    for (const member of object.properties) {
        if (ts.isSpreadAssignment(member)) {
            const spread = resolveObjectLiteral(member.expression, declarations, new Set());
            if (spread) {
                collectNamedPropertyLiterals(
                    spread,
                    property,
                    declarations,
                    target,
                    visitedObjects,
                    storageFragments,
                    storageVersionChanges,
                    storageTransformedSources
                );
            }
            continue;
        }
        if (ts.isPropertyAssignment(member) && propertyName(member.name) === property) {
            if (storageFragments && storageVersionChanges && storageTransformedSources)
                collectStorageExpressionLiterals(
                    member.initializer,
                    declarations,
                    target,
                    storageFragments,
                    storageVersionChanges,
                    storageTransformedSources,
                    new Set()
                );
            else collectExpressionLiterals(member.initializer, declarations, target, new Set());
            continue;
        }
        if (ts.isShorthandPropertyAssignment(member) && member.name.text === property) {
            if (storageFragments && storageVersionChanges && storageTransformedSources)
                collectStorageExpressionLiterals(
                    member.name,
                    declarations,
                    target,
                    storageFragments,
                    storageVersionChanges,
                    storageTransformedSources,
                    new Set()
                );
            else collectExpressionLiterals(member.name, declarations, target, new Set());
        }
    }
}

function collectConstructorRoles(sourceFile: ts.SourceFile): Readonly<{
    compute: ReadonlySet<ts.Node>;
    storageGraphics: ReadonlySet<ts.Node>;
    storageFragments: ReadonlySet<ts.Node>;
    storageVersionChanges: ReadonlySet<ts.Node>;
    storageTransformedSources: ReadonlyMap<ts.Node, string>;
    ordinaryGraphics: ReadonlySet<ts.Node>;
}> {
    const declarations = collectVariableDeclarations(sourceFile);
    const compute = new Set<ts.Node>();
    const storageGraphics = new Set<ts.Node>();
    const storageFragments = new Set<ts.Node>();
    const storageVersionChanges = new Set<ts.Node>();
    const storageTransformedSources = new Map<ts.Node, string>();
    const ordinaryGraphics = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
        if (ts.isNewExpression(node)) {
            const name = constructorName(node.expression);
            const descriptor = node.arguments?.[0];
            if (descriptor) {
                if (name === 'ComputeShader') {
                    const object = resolveObjectLiteral(descriptor, declarations, new Set());
                    if (object) {
                        collectNamedPropertyLiterals(
                            object,
                            'source',
                            declarations,
                            compute,
                            new Set()
                        );
                    }
                } else if (name === 'StorageGraphicsShader') {
                    const object = resolveObjectLiteral(descriptor, declarations, new Set());
                    if (object) {
                        collectNamedPropertyLiterals(
                            object,
                            'vertexSource',
                            declarations,
                            storageGraphics,
                            new Set(),
                            storageFragments,
                            storageVersionChanges,
                            storageTransformedSources
                        );
                        collectNamedPropertyLiterals(
                            object,
                            'fragmentSource',
                            declarations,
                            storageGraphics,
                            new Set(),
                            storageFragments,
                            storageVersionChanges,
                            storageTransformedSources
                        );
                    }
                } else if (name === 'Shader' || name === 'Material') {
                    collectExpressionLiterals(
                        descriptor,
                        declarations,
                        ordinaryGraphics,
                        new Set()
                    );
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return {
        compute,
        storageGraphics,
        storageFragments,
        storageVersionChanges,
        storageTransformedSources,
        ordinaryGraphics
    };
}

function isProductionSource(path: string): boolean {
    return path.startsWith('src/') || path.startsWith('examples/');
}

function lineAt(sourceFile: ts.SourceFile, offset: number): number {
    return sourceFile.getLineAndCharacterOfPosition(offset).line + 1;
}

function hasExactReadonlyStorageBlocks(source: string): boolean {
    glslStorageBlockPattern.lastIndex = 0;
    glslLooseStorageBlockGlobalPattern.lastIndex = 0;
    const looseBlockCount = [...source.matchAll(glslLooseStorageBlockGlobalPattern)].length;
    let exactBlockCount = 0;
    for (const match of source.matchAll(glslStorageBlockPattern)) {
        exactBlockCount++;
        const qualifiers = (match[1] ?? '')
            .split(',')
            .map(value => value.trim())
            .filter(value => value.length > 0);
        if (qualifiers.length !== 1 || qualifiers[0] !== 'std430' || match[2] === undefined) {
            return false;
        }
    }
    return exactBlockCount === looseBlockCount;
}

function isShaderGuardExempt(path: string): boolean {
    return (
        path === shaderGuardFixturePath ||
        path === shaderGuardImplementationPath ||
        path === storageGraphicsBoundaryImplementationPath
    );
}

/**
 * Enforce the repository's shader-language boundary without treating generated WGSL artifacts as
 * source. Direct WGSL is limited to `ComputeShader.source` and explicit compute fixtures; storage
 * graphics is limited to the constrained `StorageGraphicsShader` GLSL ES 3.10 path.
 */
export function collectShaderModernityViolations(
    path: string,
    source: string
): readonly ShaderModernityViolation[] {
    if (isShaderGuardExempt(path)) return [];
    if (path.endsWith('.wgsl')) {
        return [{ label: 'parallel handwritten WGSL shader file', line: 1 }];
    }

    const extension = path.slice(path.lastIndexOf('.'));
    const isTypeScript = new Set(['.ts', '.tsx', '.mts', '.cts']).has(extension);
    if (!isTypeScript) {
        const violations: ShaderModernityViolation[] = [];
        if (controlledStorageGraphicsChunkPaths.has(path)) {
            if (!hasExactReadonlyStorageBlocks(source)) {
                violations.push({
                    label: 'StorageGraphicsShader storage block is not readonly std430',
                    line: 1
                });
            }
            if (glslComputeDialectPattern.test(source)) {
                violations.push({ label: 'GLSL compute dialect', line: 1 });
            }
            return violations;
        }
        const version = glslVersionPattern.exec(source);
        if (version && (version[1] !== '300' || version[2] !== 'es')) {
            violations.push({ label: 'graphics shader source is not GLSL ES 3.00', line: 1 });
        }
        if (glslLooseStorageBlockPattern.test(source)) {
            violations.push({ label: 'ordinary graphics shader declares storage buffer', line: 1 });
        }
        if (glslComputeDialectPattern.test(source)) {
            violations.push({ label: 'GLSL compute dialect', line: 1 });
        }
        return violations;
    }

    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const literals = collectSourceLiterals(sourceFile);
    const roles = collectConstructorRoles(sourceFile);
    const violations: ShaderModernityViolation[] = [];
    const seen = new Set<string>();
    const add = (literal: SourceLiteral, label: string): void => {
        const line = lineAt(sourceFile, literal.offset);
        const key = `${String(line)}:${label}`;
        if (seen.has(key)) return;
        seen.add(key);
        violations.push({ label, line });
    };

    const checkedLiterals: readonly SourceLiteral[] = [
        ...literals,
        ...[...roles.storageTransformedSources].map(([node, text]) => ({
            node,
            text,
            offset: node.getStart(sourceFile)
        }))
    ];
    for (const literal of checkedLiterals) {
        const text = literal.text;
        const hasCompute = wgslComputePattern.test(text);
        const hasVertex = wgslVertexPattern.test(text);
        const hasFragment = wgslFragmentPattern.test(text);
        const hasGraphicsStage = hasVertex || hasFragment;
        const computeSource = roles.compute.has(literal.node);
        const completeStorageSource = roles.storageGraphics.has(literal.node);
        const storageGraphicsSource =
            completeStorageSource || roles.storageFragments.has(literal.node);
        const ordinaryGraphicsSource = roles.ordinaryGraphics.has(literal.node);
        const controlledComputeFixture = controlledComputeFixturePaths.has(path);
        const compilerNegativeFixture = compilerNegativeFixturePaths.has(path);
        const controlledStorageFixture = controlledStorageGraphicsFixturePaths.has(path);

        if (ordinaryGraphicsSource && (hasCompute || hasGraphicsStage)) {
            add(literal, 'ordinary Shader or Material uses handwritten WGSL');
        }
        if (computeSource && hasGraphicsStage && !compilerNegativeFixture) {
            add(literal, 'ComputeShader source declares a graphics WGSL entry point');
        }
        if (hasCompute && hasGraphicsStage && !compilerNegativeFixture) {
            add(literal, 'Direct WGSL compute source mixes graphics entry points');
        }
        if (hasCompute && !computeSource && !controlledComputeFixture && !compilerNegativeFixture) {
            add(
                literal,
                'Direct WGSL compute source is outside ComputeShader or a controlled fixture'
            );
        }
        if (hasGraphicsStage && isProductionSource(path)) {
            add(literal, 'handwritten graphics WGSL source');
        }

        const version = glslVersionPattern.exec(text);
        const has310 = glsl310Pattern.test(text);
        const hasStorageBlock = glslLooseStorageBlockPattern.test(text);
        const hasComputeDialect = glslComputeDialectPattern.test(text);
        if (hasComputeDialect) add(literal, 'GLSL compute dialect');
        if (ordinaryGraphicsSource && (has310 || hasStorageBlock)) {
            add(literal, 'ordinary Shader or Material uses GLSL ES 3.10 storage graphics');
        }
        if ((has310 || hasStorageBlock) && !storageGraphicsSource && !controlledStorageFixture) {
            add(literal, 'storage graphics source is outside StorageGraphicsShader');
        }
        if (storageGraphicsSource && !controlledStorageFixture) {
            if (
                (completeStorageSource || version !== null) &&
                (!has310 || version?.[1] !== '310' || version[2] !== 'es')
            ) {
                add(literal, 'StorageGraphicsShader source is not GLSL ES 3.10');
            }
            if (hasStorageBlock && !hasExactReadonlyStorageBlocks(text)) {
                add(literal, 'StorageGraphicsShader storage block is not readonly std430');
            }
        }
    }
    if (!controlledStorageGraphicsFixturePaths.has(path))
        for (const node of roles.storageVersionChanges)
            violations.push({
                label: 'StorageGraphicsShader transformation changes the GLSL ES 3.10 version',
                line: lineAt(sourceFile, node.getStart(sourceFile))
            });
    return violations;
}
