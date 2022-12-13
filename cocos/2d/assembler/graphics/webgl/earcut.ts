/*
 Copyright (c) 2017-2020 Xiamen Yaji Software Co., Ltd.

 http://www.cocos.com

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
 worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
 not use Cocos Creator software for developing other software or tools that's
 used for developing games. You are not granted to publish, distribute,
 sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
*/

class Aim {
    // vertex index in coordinates array
    public i: number;

    // vertex coordinates
    public x: number;
    public y: number;

    // previous and next vertex nodes in a polygon ring
    public prev: Aim | null = null;
    public next: Aim | null = null;

    // z-order curve value
    public z: number = null as any;

    // previous and next nodes in z-order
    public prevZ: Aim | null = null;
    public nextZ: Aim | null = null;

    // indicates whether this is a steiner point
    public steiner = false;

    constructor (i: number, x: number, y: number) {
        this.i = i;
        this.x = x;
        this.y = y;
    }
}

// create a circular doubly linked list from polygon points in the specified winding order
function linkedList (datas: number[], start: number, end: number, dim: number, clockwise: boolean) {
    let i = 0;
    let last: Aim | null = null;

    if (clockwise === (signedArea(datas, start, end, dim) > 0)) {
        for (i = start; i < end; i += dim) {
            last = insertNode(i, datas[i], datas[i + 1], last);
        }
    } else {
        for (i = end - dim; i >= start; i -= dim) {
            last = insertNode(i, datas[i], datas[i + 1], last);
        }
    }

    if (last && equals(last, last.next!)) {
        removeNode(last);
        last = last.next;
    }

    return last;
}

// eliminate colinear or duplicate points
function filterPoints (start: Aim | null, end: Aim | null = null) {
    if (!start) {
        return start;
    }

    if (!end) {
        end = start;
    }

    let p = start;
    let again = false;
    do {
        again = false;

        if (!p.steiner && (equals(p, p.next!) || area(p.prev!, p, p.next!) === 0)) {
            removeNode(p);
            p = end = p.prev!;
            if (p === p.next) {
                return null;
            }
            again = true;
        } else {
            p = p.next!;
        }
    } while (again || p !== end);

    return end;
}

// main ear slicing loop which triangulates a polygon (given as a linked list)
function earcutLinked (ear: Aim | null, triangles: number[], dim: number, minX: number, minY: number, size: number, pass = 0) {
    if (!ear) {
        return;
    }

    // interlink polygon nodes in z-order
    if (!pass && size) {
        indexCurve(ear, minX, minY, size);
    }

    let stop: Aim | null = ear;
    let prev: Aim | null = null;
    let next: Aim | null = null;

    // iterate through ears, slicing them one by one
    while (ear!.prev !== ear!.next) {
        prev = ear!.prev!;
        next = ear!.next!;

        if (size ? isEarHashed(ear!, minX, minY, size) : isEar(ear!)) {
            // cut off the triangle
            triangles.push(prev.i / dim);
            triangles.push(ear!.i / dim);
            triangles.push(next.i / dim);

            removeNode(ear!);

            // skipping the next vertices leads to less sliver triangles
            ear = next.next;
            stop = next.next;

            continue;
        }

        ear = next;

        // if we looped through the whole remaining polygon and can't find any more ears
        if (ear === stop) {
            // try filtering points and slicing again
            if (!pass) {
                earcutLinked(filterPoints(ear), triangles, dim, minX, minY, size, 1);

            // if this didn't work, try curing all small self-intersections locally
            } else if (pass === 1) {
                ear = cureLocalIntersections(ear, triangles, dim);
                earcutLinked(ear, triangles, dim, minX, minY, size, 2);

            // as a last resort, try splitting the remaining polygon into two
            } else if (pass === 2) {
                splitEarcut(ear, triangles, dim, minX, minY, size);
            }

            break;
        }
    }
}

// check whether a polygon node forms a valid ear with adjacent nodes
function isEar (ear: Aim) {
    const a = ear.prev!;
    const b = ear;
    const c = ear.next!;

    if (area(a, b, c) >= 0) { return false; } // reflex, can't be an ear

    // now make sure we don't have other points inside the potential ear
    let p = ear.next!.next!;

    while (p !== ear.prev) {
        if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y)
            && area(p.prev!, p, p.next!) >= 0) { return false; }
        p = p.next!;
    }

    return true;
}

function isEarHashed (ear: Aim, minX: number, minY: number, size) {
    const a = ear.prev!;
    const b = ear;
    const c = ear.next!;

    if (area(a, b, c) >= 0) { return false; } // reflex, can't be an ear

    // triangle bbox; min & max are calculated like this for speed
    const minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x);
    const minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y);
    const maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x);
    const maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);

    // z-order range for the current triangle bbox;
    const minZ = zOrder(minTX, minTY, minX, minY, size);
    const maxZ = zOrder(maxTX, maxTY, minX, minY, size);

    // first look for points inside the triangle in increasing z-order
    let p = ear.nextZ;

    while (p && p.z <= maxZ) {
        if (p !== ear.prev && p !== ear.next
            && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y)
            && area(p.prev!, p, p.next!) >= 0) { return false; }
        p = p.nextZ;
    }

    // then look for points in decreasing z-order
    p = ear.prevZ;

    while (p && p.z >= minZ) {
        if (p !== ear.prev && p !== ear.next
            && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y)
            && area(p.prev!, p, p.next!) >= 0) {
            return false;
        }

        p = p.prevZ;
    }

    return true;
}

// go through all polygon nodes and cure small local self-intersections
function cureLocalIntersections (start: Aim, triangles: number[], dim: number) {
    let p = start;
    do {
        const a = p.prev!;
        const b = p.next!.next!;

        if (!equals(a, b) && intersects(a, p, p.next!, b) && locallyInside(a, b) && locallyInside(b, a)) {
            triangles.push(a.i / dim);
            triangles.push(p.i / dim);
            triangles.push(b.i / dim);

            // remove two nodes involved
            removeNode(p);
            removeNode(p.next!);

            p = start = b;
        }
        p = p.next!;
    } while (p !== start);

    return p;
}

// try splitting polygon into two and triangulate them independently
function splitEarcut (start: Aim | null, triangles: number[], dim: number, minX: number, minY: number, size: number) {
    // look for a valid diagonal that divides the polygon into two
    let a = start!;
    do {
        let b = a.next!.next;
        while (b !== a.prev) {
            if (a.i !== b!.i && isValidDiagonal(a, b!)) {
                // split the polygon in two by the diagonal
                let c = splitPolygon(a, b!);

                // filter colinear points around the cuts
                a = filterPoints(a, a.next)!;
                c = filterPoints(c, c.next)!;

                // run earcut on each half
                earcutLinked(a, triangles, dim, minX, minY, size);
                earcutLinked(c, triangles, dim, minX, minY, size);
                return;
            }
            b = b!.next;
        }
        a = a.next!;
    } while (a !== start);
}

// link every hole into the outer loop, producing a single-ring polygon without holes
function eliminateHoles (datas: number[], holeIndices: number[], outerNode: Aim | null, dim: number) {
    const queue: Aim[] = [];
    let i = 0;
    let len = 0;
    let start = 0;
    let end = 0;
    let list: Aim | null = null;

    for (i = 0, len = holeIndices.length; i < len; i++) {
        start = holeIndices[i] * dim;
        end = i < len - 1 ? holeIndices[i + 1] * dim : datas.length;
        list = linkedList(datas, start, end, dim, false);
        if (!list) {
            continue;
        }
        if (list === list.next) {
            list.steiner = true;
        }

        queue.push(getLeftmost(list));
    }

    queue.sort(compareX);

    if (!outerNode) {
        return outerNode;
    }

    // process holes from left to right
    for (i = 0; i < queue.length; i++) {
        eliminateHole(queue[i], outerNode);
        outerNode = filterPoints(outerNode, outerNode!.next);
    }

    return outerNode;
}

function compareX (a, b) {
    return a.x - b.x;
}

// find a bridge between vertices that connects hole with an outer ring and and link it
function eliminateHole (hole: Aim, outerNode: Aim | null) {
    outerNode = findHoleBridge(hole, outerNode!);
    if (outerNode) {
        const b = splitPolygon(outerNode, hole);
        filterPoints(b, b.next);
    }
}

// David Eberly's algorithm for finding a bridge between hole and outer polygon
function findHoleBridge (hole: Aim, outerNode: Aim) {
    let p = outerNode;
    const hx = hole.x;
    const hy = hole.y;
    let qx = -Infinity;
    let m: Aim | null = null;

    // find a segment intersected by a ray from the hole's leftmost point to the left;
    // segment's endpoint with lesser x will be potential connection point
    do {
        if (hy <= p.y && hy >= p.next!.y) {
            const x = p.x + (hy - p.y) * (p.next!.x - p.x) / (p.next!.y - p.y);
            if (x <= hx && x > qx) {
                qx = x;
                if (x === hx) {
                    if (hy === p.y) { return p; }
                    if (hy === p.next!.y) { return p.next; }
                }
                m = p.x < p.next!.x ? p : p.next!;
            }
        }
        p = p.next!;
    } while (p !== outerNode);

    if (!m) {
        return null;
    }

    if (hx === qx) {
        return m.prev;
    } // hole touches outer segment; pick lower endpoint

    // look for points inside the triangle of hole point, segment intersection and endpoint;
    // if there are no points found, we have a valid connection;
    // otherwise choose the point of the minimum angle with the ray as connection point

    const stop = m;
    const mx = m.x;
    const my = m.y;
    let tanMin = Infinity;
    let tan;

    p = m.next!;

    while (p !== stop) {
        if (hx >= p.x && p.x >= mx
                && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
            tan = Math.abs(hy - p.y) / (hx - p.x); // tangential

            if ((tan < tanMin || (tan === tanMin && p.x > m.x)) && locallyInside(p, hole)) {
                m = p;
                tanMin = tan;
            }
        }

        p = p.next!;
    }

    return m;
}

// interlink polygon nodes in z-order
function indexCurve (start: Aim, minX: number, minY: number, size: number) {
    let p = start;
    do {
        if (p.z === null) {
            p.z = zOrder(p.x, p.y, minX, minY, size);
        }

        p.prevZ = p.prev;
        p.nextZ = p.next;
        p = p.next!;
    } while (p !== start);

    p.prevZ!.nextZ = null;
    p.prevZ = null;

    sortLinked(p);
}

// Simon Tatham's linked list merge sort algorithm
// http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html
function sortLinked (list: Aim | null) {
    let i = 0;
    let p: Aim | null = null;
    let q: Aim | null = null;
    let e: Aim | null = null;
    let tail: Aim | null = null;
    let numMerges = 0;
    let pSize = 0;
    let qSize = 0;
    let inSize = 1;

    do {
        p = list;
        list = null;
        tail = null;
        numMerges = 0;

        while (p) {
            numMerges++;
            q = p;
            pSize = 0;
            for (i = 0; i < inSize; i++) {
                pSize++;
                q = q.nextZ;
                if (!q) { break; }
            }

            qSize = inSize;

            while (pSize > 0 || (qSize > 0 && q)) {
                if (pSize === 0) {
                    e = q;
                    q = q!.nextZ;
                    qSize--;
                } else if (qSize === 0 || !q) {
                    e = p;
                    p = p!.nextZ;
                    pSize--;
                } else if (p!.z <= q.z) {
                    e = p;
                    p = p!.nextZ;
                    pSize--;
                } else {
                    e = q;
                    q = q.nextZ;
                    qSize--;
                }

                if (tail) { tail.nextZ = e; } else { list = e; }

                e!.prevZ = tail;
                tail = e;
            }

            p = q;
        }

        tail!.nextZ = null;
        inSize *= 2;
    } while (numMerges > 1);

    return list;
}

// z-order of a point given coords and size of the data bounding box
function zOrder (x: number, y: number, minX: number, minY: number, size: number) {
    // coords are transformed into non-negative 15-bit integer range
    x = 32767 * (x - minX) / size;
    y = 32767 * (y - minY) / size;

    x = (x | (x << 8)) & 0x00FF00FF;
    x = (x | (x << 4)) & 0x0F0F0F0F;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;

    y = (y | (y << 8)) & 0x00FF00FF;
    y = (y | (y << 4)) & 0x0F0F0F0F;
    y = (y | (y << 2)) & 0x33333333;
    y = (y | (y << 1)) & 0x55555555;

    return x | (y << 1);
}

// find the leftmost node of a polygon ring
function getLeftmost (start: Aim) {
    let p = start;
    let leftmost = start;
    do {
        if (p.x < leftmost.x) {
            leftmost = p;
        }

        p = p.next!;
    } while (p !== start);

    return leftmost;
}

// check if a point lies within a convex triangle
function pointInTriangle (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number) {
    return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0
           && (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0
           && (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
}

// check if a diagonal between two polygon nodes is valid (lies in polygon interior)
function isValidDiagonal (a: Aim, b: Aim) {
    return a.next!.i !== b.i && a.prev!.i !== b.i && !intersectsPolygon(a, b)
           && locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b);
}

// signed area of a triangle
function area (p: Aim, q: Aim, r: Aim) {
    return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

// check if two points are equal
function equals (p1: Aim, p2: Aim) {
    return p1.x === p2.x && p1.y === p2.y;
}

// check if two segments intersect
function intersects (p1: Aim, q1: Aim, p2: Aim, q2: Aim) {
    if ((equals(p1, q1) && equals(p2, q2))
        || (equals(p1, q2) && equals(p2, q1))) {
        return true;
    }

    return area(p1, q1, p2) > 0 !== area(p1, q1, q2) > 0
           && area(p2, q2, p1) > 0 !== area(p2, q2, q1) > 0;
}

// check if a polygon diagonal intersects any polygon segments
function intersectsPolygon (a: Aim, b: Aim) {
    let p = a;
    do {
        if (p.i !== a.i && p.next!.i !== a.i && p.i !== b.i && p.next!.i !== b.i
                && intersects(p, p.next!, a, b)) { return true; }
        p = p.next!;
    } while (p !== a);

    return false;
}

// check if a polygon diagonal is locally inside the polygon
function locallyInside (a: Aim, b: Aim) {
    return area(a.prev!, a, a.next!) < 0
        ? area(a, b, a.next!) >= 0 && area(a, a.prev!, b) >= 0
        : area(a, b, a.prev!) < 0 || area(a, a.next!, b) < 0;
}

// check if the middle point of a polygon diagonal is inside the polygon
function middleInside (a: Aim, b: Aim) {
    let p = a;
    let inside = false;
    const px = (a.x + b.x) / 2;
    const py = (a.y + b.y) / 2;
    do {
        if (((p.y > py) !== (p.next!.y > py)) && (px < (p.next!.x - p.x) * (py - p.y) / (p.next!.y - p.y) + p.x)) {
            inside = !inside;
        }
        p = p.next!;
    } while (p !== a);

    return inside;
}

// link two polygon vertices with a bridge; if the vertices belong to the same ring, it splits polygon into two;
// if one belongs to the outer ring and another to a hole, it merges it into a single ring
function splitPolygon (a: Aim, b: Aim) {
    const a2 = new Aim(a.i, a.x, a.y);
    const b2 = new Aim(b.i, b.x, b.y);
    const an = a.next!;
    const bp = b.prev!;

    a.next = b;
    b.prev = a;

    a2.next = an;
    an.prev = a2;

    b2.next = a2;
    a2.prev = b2;

    bp.next = b2;
    b2.prev = bp;

    return b2;
}

// create a node and optionally link it with previous one (in a circular doubly linked list)
function insertNode (i: number, x: number, y: number, last: Aim | null) {
    const p = new Aim(i, x, y);

    if (!last) {
        p.prev = p;
        p.next = p;
    } else {
        p.next = last.next;
        p.prev = last;
        last.next!.prev = p;
        last.next = p;
    }

    return p;
}

function removeNode (p: Aim) {
    p.next!.prev = p.prev;
    p.prev!.next = p.next;

    if (p.prevZ) {
        p.prevZ.nextZ = p.nextZ;
    }

    if (p.nextZ) {
        p.nextZ.prevZ = p.prevZ;
    }
}

function signedArea (datas: number[], start: number, end: number, dim: number) {
    let sum = 0;
    for (let i = start, j = end - dim; i < end; i += dim) {
        sum += (datas[j] - datas[i]) * (datas[i + 1] + datas[j + 1]);
        j = i;
    }
    return sum;
}

export function earcut (datas: number[], holeIndices: number[] | null, dim: number) {
    dim = dim || 3;

    const hasHoles = holeIndices ? holeIndices.length : 0;
    const outerLen = hasHoles ? holeIndices![0] * dim : datas.length;
    let outerNode = linkedList(datas, 0, outerLen, dim, true);
    const triangles: number[] = [];

    if (!outerNode) {
        return triangles;
    }

    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    let x = 0;
    let y = 0;
    let size = 0;

    if (hasHoles) {
        outerNode = eliminateHoles(datas, holeIndices!, outerNode, dim);
    }

    // if the shape is not too simple, we'll use z-order curve hash later; calculate polygon bbox
    if (datas.length > 80 * dim) {
        minX = maxX = datas[0];
        minY = maxY = datas[1];

        for (let i = dim; i < outerLen; i += dim) {
            x = datas[i];
            y = datas[i + 1];
            if (x < minX) { minX = x; }
            if (y < minY) { minY = y; }
            if (x > maxX) { maxX = x; }
            if (y > maxY) { maxY = y; }
        }

        // minX, minY and size are later used to transform coords into integers for z-order calculation
        size = Math.max(maxX - minX, maxY - minY);
    }

    earcutLinked(outerNode, triangles, dim, minX, minY, size);

    return triangles;
}

// // return a percentage difference between the polygon area and its triangulation area;
// // used to verify correctness of triangulation
// earcut.deviation = function (data, holeIndices, dim, triangles) {
//     const hasHoles = holeIndices && holeIndices.length;
//     const outerLen = hasHoles ? holeIndices[0] * dim : data.length;

//     let polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
//     if (hasHoles) {
//         for (let i = 0, len = holeIndices.length; i < len; i++) {
//             const start = holeIndices[i] * dim;
//             const end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
//             polygonArea -= Math.abs(signedArea(data, start, end, dim));
//         }
//     }

//     let trianglesArea = 0;
//     for (i = 0; i < triangles.length; i += 3) {
//         const a = triangles[i] * dim;
//         const b = triangles[i + 1] * dim;
//         const c = triangles[i + 2] * dim;
//         trianglesArea += Math.abs(
//             (data[a] - data[c]) * (data[b + 1] - data[a + 1]) -
//             (data[a] - data[b]) * (data[c + 1] - data[a + 1]));
//     }

//     return polygonArea === 0 && trianglesArea === 0 ? 0 :
//         Math.abs((trianglesArea - polygonArea) / polygonArea);
// };

// // turn a polygon in a multi-dimensional array form (e.g. as in GeoJSON) into a form Earcut accepts
// earcut.flatten = function (data) {
//     let dim = data[0][0].length,
//         result = {vertices: [], holes: [], dimensions: dim},
//         holeIndex = 0;

//     for (let i = 0; i < data.length; i++) {
//         for (let j = 0; j < data[i].length; j++) {
//             for (let d = 0; d < dim; d++) { result.vertices.push(data[i][j][d]); }
//         }
//         if (i > 0) {
//             holeIndex += data[i - 1].length;
//             result.holes.push(holeIndex);
//         }
//     }
//     return result;
// };