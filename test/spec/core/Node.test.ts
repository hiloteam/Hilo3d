import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { NodeTraverseCallback } from '../../../src/core/Node';

const Node = Hilo3d.Node;

describe('Node', () => {
    it('create', () => {
        const node = new Node();
        expect(node.isNode).toBe(true);
        expect(node.className).toBe('Node');
        expect(node.up.isVector3).toBe(true);
    });

    it('clone', () => {
        const node = new Node({
            name: 'parent',
            x: 2,
            y: 3,
            z: 1,
            jointName: 'head'
        });
        node.addChild(
            new Node({
                name: 'child0'
            })
        );

        const clonedNode = node.clone();
        expect(clonedNode.name).toBe(node.name);
        expect(clonedNode.x).toBe(node.x);
        expect(clonedNode.y).toBe(node.y);
        expect(clonedNode.z).toBe(node.z);
        expect(clonedNode.jointName).toBe(node.jointName);
        expect(clonedNode.children).toHaveLength(1);
        expect(clonedNode.children.at(0)?.name).toBe('child0');
    });

    it('getChildrenNameMap', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({
            name: 'b3'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);

        const map = node.getChildrenNameMap();
        expect(map['b1']).toBe(b1);
        expect(map['b2']).toBe(b2);
        expect(map['b3']).toBe(b3);
        expect(map['a1']).toBeUndefined();
    });

    it('getChild', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({ name: 'b3' });
        b3.id = 'hhh';

        const b4 = new Node({
            name: 'b4'
        });

        const b5 = new Node({
            name: 'b5'
        });

        const b6 = new Node({
            name: 'b6'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b3.addChild(b4);
        b4.addChild(b5);
        b5.addChild(b6);

        expect(node.getChildByFn(child => child.name === 'b1')).toBe(b1);
        expect(node.getChildByFn(child => child.name === 'b5')).toBe(b5);
        expect(node.getChildByFnBFS(child => child.name === 'b1')).toBe(b1);
        expect(node.getChildByFnBFS(child => child.name === 'b6')).toBe(b6);
        expect(node.getChildrenByFn(child => child.name === 'b5').at(0)).toBe(b5);
        expect(node.getChildByName('b2')).toBe(b2);
        expect(node.getChildrenByName('b2').at(0)).toBe(b2);
        expect(node.getChildById('hhh')).toBe(b3);
        expect(node.getChildrenByClassName('Node').at(0)).toBe(b1);
        expect(node.getChildByNamePath(['b3'])).toBe(b3);
        expect(node.getChildByNamePath(['b3', 'b5'])).toBe(b5);
        expect(node.getChildByNamePath(['b3', 'b5', 'b2'])).toBeNull();
    });

    it('traverse_path', () => {
        const node = new Node({
            name: 'r'
        });

        const a = new Node({
            name: 'a'
        });

        const b = new Node({
            name: 'b'
        });

        const c = new Node({
            name: 'c'
        });

        const a0 = new Node({
            name: 'a0'
        });

        const b0 = new Node({
            name: 'b0'
        });

        const c0 = new Node({
            name: 'c0'
        });

        const a1 = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const c1 = new Node({
            name: 'c1'
        });

        node.addChild(a);
        node.addChild(b);
        node.addChild(c);
        a.addChild(a0);
        b.addChild(b0);
        c.addChild(c0);
        a0.addChild(a1);
        b0.addChild(b1);
        b0.addChild(b2);
        c0.addChild(c1);

        /**
         *         r
         *       / | \
         *      a  b  c
         *     /   |   \
         *   a0    b0   c0
         *   /    /  \   \
         *  a1   b1  b2   c1
         */

        let names: string[] = [];
        node.traverse(traversedNode => {
            names.push(traversedNode.name);
        });
        expect(names.join('-')).toBe('r-a-a0-a1-b-b0-b1-b2-c-c0-c1');

        names = [];
        node.traverse(traversedNode => {
            names.push(traversedNode.name);
        }, true);
        expect(names.join('-')).toBe('a-a0-a1-b-b0-b1-b2-c-c0-c1');

        names = [];
        node.traverse(traversedNode => {
            names.push(traversedNode.name);
            return Node.TRAVERSE_STOP_NONE;
        }, true);
        expect(names.join('-')).toBe('a-a0-a1-b-b0-b1-b2-c-c0-c1');

        names = [];
        node.traverse(traversedNode => {
            names.push(traversedNode.name);
            if (traversedNode.name === 'b0') {
                return Node.TRAVERSE_STOP_ALL;
            }
            return Node.TRAVERSE_STOP_NONE;
        }, true);
        expect(names.join('-')).toBe('a-a0-a1-b-b0');

        names = [];
        node.traverse(traversedNode => {
            names.push(traversedNode.name);
            if (traversedNode.name === 'b0') {
                return Node.TRAVERSE_STOP_CHILDREN;
            }
            return Node.TRAVERSE_STOP_NONE;
        }, true);
        expect(names.join('-')).toBe('a-a0-a1-b-b0-c-c0-c1');

        // traverseBFS
        names = [];
        node.traverseBFS(traversedNode => {
            names.push(traversedNode.name);
        });
        expect(names.join('-')).toBe('r-a-b-c-a0-b0-c0-a1-b1-b2-c1');

        names = [];
        node.traverseBFS(traversedNode => {
            names.push(traversedNode.name);
        }, true);
        expect(names.join('-')).toBe('a-b-c-a0-b0-c0-a1-b1-b2-c1');

        names = [];
        node.traverseBFS(traversedNode => {
            names.push(traversedNode.name);
            return Node.TRAVERSE_STOP_NONE;
        }, true);
        expect(names.join('-')).toBe('a-b-c-a0-b0-c0-a1-b1-b2-c1');

        names = [];
        node.traverseBFS(traversedNode => {
            names.push(traversedNode.name);
            if (traversedNode.name === 'b0') {
                return Node.TRAVERSE_STOP_ALL;
            }
            return Node.TRAVERSE_STOP_NONE;
        }, true);
        expect(names.join('-')).toBe('a-b-c-a0-b0');

        names = [];
        node.traverseBFS(traversedNode => {
            names.push(traversedNode.name);
            if (traversedNode.name === 'b0') {
                return Node.TRAVERSE_STOP_CHILDREN;
            }
            return Node.TRAVERSE_STOP_NONE;
        }, true);
        expect(names.join('-')).toBe('a-b-c-a0-b0-c0-a1-c1');
    });

    it('traverse', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({
            name: 'b3'
        });

        const c1 = new Node({
            name: 'c1'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b1.addChild(c1);

        /**
         *     a1
         *   b1  b2  b3
         * c1
         */

        const callback = vi.fn<NodeTraverseCallback>();
        node.traverse(callback);
        expect(callback).toHaveBeenCalledTimes(5);

        callback.mockReset();
        callback.mockReturnValueOnce(Hilo3d.Node.TRAVERSE_STOP_ALL);
        node.traverse(callback);
        expect(callback).toHaveBeenCalledTimes(1);

        callback.mockReset();
        callback.mockReturnValueOnce(Hilo3d.Node.TRAVERSE_STOP_CHILDREN);
        node.traverse(callback);
        expect(callback).toHaveBeenCalledTimes(1);

        callback.mockReset();
        callback.mockReturnValueOnce(undefined).mockReturnValueOnce(Hilo3d.Node.TRAVERSE_STOP_ALL);
        node.traverse(callback);
        expect(callback).toHaveBeenCalledTimes(2);

        callback.mockReset();
        callback
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce(Hilo3d.Node.TRAVERSE_STOP_CHILDREN);
        node.traverse(callback);
        expect(callback).toHaveBeenCalledTimes(4);
    });

    it('traverseBFS', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({
            name: 'b3'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b2.addChild(new Node());

        const callback = vi.fn<NodeTraverseCallback>();
        node.traverseBFS(callback);
        expect(callback).toHaveBeenCalledTimes(5);

        callback.mockReset();
        callback.mockReturnValueOnce(Hilo3d.Node.TRAVERSE_STOP_CHILDREN);
        node.traverseBFS(callback);
        expect(callback).toHaveBeenCalledTimes(1);

        callback.mockReset();
        callback
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce(Hilo3d.Node.TRAVERSE_STOP_CHILDREN);
        node.traverseBFS(callback);
        expect(callback).toHaveBeenCalledTimes(4);

        callback.mockReset();
        callback
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce(Hilo3d.Node.TRAVERSE_STOP_ALL);
        node.traverseBFS(callback);
        expect(callback).toHaveBeenCalledTimes(3);
    });

    it('traverseUpdate', () => {
        const node = new Node();
        const b1 = new Node();
        const b2 = new Node();
        const b3 = new Node();
        const c1 = new Node();

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b3.addChild(c1);

        const onUpdate = vi.fn<(deltaTime: number) => void>();

        node.onUpdate = onUpdate;
        b1.onUpdate = onUpdate;
        b2.onUpdate = onUpdate;
        b3.onUpdate = onUpdate;
        c1.onUpdate = onUpdate;

        node.traverseUpdate(16);
        expect(onUpdate).toHaveBeenCalledTimes(5);

        onUpdate.mockReset();
        b3.needCallChildUpdate = false;
        node.traverseUpdate(16);
        expect(onUpdate).toHaveBeenCalledTimes(4);

        onUpdate.mockReset();
        node.needCallChildUpdate = false;
        node.traverseUpdate(16);
        expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it('raycast', () => {
        const node = new Node({
            name: 'r'
        });

        const a = new Node({
            name: 'a'
        });

        const b = new Node({
            name: 'b'
        });

        const c = new Node({
            name: 'c'
        });

        const a0 = new Node({
            name: 'a0'
        });

        const b0 = new Node({
            name: 'b0'
        });

        const c0 = new Node({
            name: 'c0'
        });

        const a1 = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const c1 = new Node({
            name: 'c1'
        });

        node.addChild(a);
        node.addChild(b);
        node.addChild(c);
        a.addChild(a0);
        b.addChild(b0);
        c.addChild(c0);
        a0.addChild(a1);
        b0.addChild(b1);
        b0.addChild(b2);
        c0.addChild(c1);

        /**
         *         r
         *       / | \
         *      a  b  c
         *     /   |   \
         *   a0    b0   c0
         *   /    /  \   \
         *  a1   b1  b2   c1
         */

        const pathList: string[] = [];
        node.traverse(traversedNode => {
            traversedNode.raycast = () => {
                pathList.push(traversedNode.name);
                return [];
            };
            traversedNode.isMesh = true;
        }, true);
        const ray = new Hilo3d.Ray();

        pathList.length = 0;
        node.raycast(ray, false, true);
        expect(pathList.join('-')).toBe('a-a0-a1-b-b0-b1-b2-c-c0-c1');

        pathList.length = 0;
        node.pointerChildren = false;
        node.raycast(ray, false, true);
        expect(pathList.join('-')).toBe('');

        node.pointerChildren = true;
        a.pointerEnabled = false;
        b.pointerChildren = false;
        c0.pointerChildren = false;
        pathList.length = 0;
        node.raycast(ray, false, true);
        expect(pathList.join('-')).toBe('b-c-c0');
    });
});
