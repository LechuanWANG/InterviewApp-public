"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ROUNDS = exports.REPORT_WEIGHTS = exports.REPORT_DIMENSIONS = void 0;
exports.REPORT_DIMENSIONS = [
    "岗位匹配度",
    "回答完整度",
    "逻辑性",
    "专业度",
    "沟通表达",
];
exports.REPORT_WEIGHTS = {
    岗位匹配度: 0.2,
    回答完整度: 0.25,
    逻辑性: 0.2,
    专业度: 0.25,
    沟通表达: 0.1,
};
exports.MAX_ROUNDS = 8;
