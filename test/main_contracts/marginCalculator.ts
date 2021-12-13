/*
Currently if you were to run the tests --> get 4 fails:
    AssertionError: Expected "0" to be equal 31709791983764586000
    AssertionError: Expected "0" to be equal 7927447995941146000
    (the above two errors happen because the tests assume hardcoded margin engine parameter values without setting them first)
    (these parameters include minDelta, etc)
    Error: VM Exception while processing transaction: reverted with panic code 0x12 (Division or modulo division by zero)
    Error: VM Exception while processing transaction: reverted with panic code 0x12 (Division or modulo division by zero)
    (the above two errors also happened because the some of the parameteres have default values of zero, some of them are used in the denominators of math fractions)
*/

import { Wallet, BigNumber } from "ethers";
import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { MarginCalculator } from "../../typechain/MarginCalculator";
import { toBn } from "evm-bn";
import { div, sub, mul, add } from "../shared/functions";
import { encodeSqrtRatioX96, expandTo18Decimals, accrualFact, fixedFactor } from "../shared/utilities";
import {FixedAndVariableMath} from "../../typechain/FixedAndVariableMath";

import { MarginCalculatorTest } from "../../typechain/MarginCalculatorTest";

const createFixtureLoader = waffle.createFixtureLoader;

// below numbers are arbitrary for now, move into another file
const APY_UPPER_MULTIPLIER = toBn("1.5"); // todo: use Neil's toBn implementation
const APY_LOWER_MULTIPLIER = toBn("0.7");
const MIN_DELTA_LM = toBn("0.03");
const MIN_DELTA_IM = toBn("0.06");
const MAX_LEVERAGE = toBn("10.0");
const SIGMA_SQUARED = toBn("0.01");
const ALPHA = toBn("0.04");
const BETA = toBn("1.0");
const XI_UPPER = toBn("2.0");
const XI_LOWER = toBn("1.5");
const RATE_ORACLE_ID = ethers.utils.formatBytes32String("AaveV2");


function getTraderMarginRequirement(fixedTokenBalance: BigNumber,
    variableTokenBalance: BigNumber, termStartTimestamp: BigNumber, termEndTimestamp: BigNumber,
    isLM: boolean) : BigNumber {

        const isFT: boolean = variableTokenBalance < toBn("0")

        const timeInSeconds: BigNumber = sub(termEndTimestamp, termStartTimestamp)

        const exp1: BigNumber = mul(fixedTokenBalance, fixedFactor(true, termStartTimestamp, termEndTimestamp))

        const exp2: BigNumber = mul(variableTokenBalance, worstCaseVariableFactorAtMaturity(timeInSeconds, isFT, isLM))

        let margin: BigNumber = add(exp1, exp2)

        const minimumMargin: BigNumber = getMinimumMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)

        if (margin < minimumMargin) {
            margin = minimumMargin
        }

        return margin
}

function worstCaseVariableFactorAtMaturity(timeInSeconds: BigNumber, isFT: boolean, isLM: boolean) : BigNumber {
    const timeInYears: BigNumber = accrualFact(timeInSeconds)
    let variableFactor: BigNumber;

    if (isFT) {
        if (isLM) {
            variableFactor = mul(timeInYears, toBn("0.09"))
        } else {
            variableFactor = mul(timeInYears, mul(toBn("0.09"), toBn("2.0")))
        }
    } else {
        if (isLM) {
            variableFactor = mul(timeInYears, toBn("0.01"))
        } else {
            variableFactor = mul(timeInYears, mul(toBn("0.09"), toBn("0.5")))
        }
    }

    return variableFactor

}

function getMinimumMarginRequirement(fixedTokenBalance: BigNumber,
    variableTokenBalance: BigNumber, termStartTimestamp: BigNumber, termEndTimestamp: BigNumber,
    isLM: boolean) {

    const timeInSeconds: BigNumber = sub(termEndTimestamp, termStartTimestamp)
    const timeInYears: BigNumber = accrualFact(timeInSeconds)
    let minDelta: BigNumber;
    let margin: BigNumber;
    let notional: BigNumber;

    if (isLM) {
        minDelta = toBn("0.0125")
    } else {
        minDelta = toBn("0.05")
    }

    if (variableTokenBalance < toBn("0")) {
        // isFT
        notional = mul(variableTokenBalance, toBn("-1"))
        margin = mul(notional, mul(minDelta, timeInYears))
    } else {
        notional = variableTokenBalance
        const zeroLowerBoundMargin: BigNumber = mul(fixedTokenBalance, mul(fixedFactor(true, termStartTimestamp, termEndTimestamp), toBn("-1")))
        margin = mul(mul(variableTokenBalance, minDelta), timeInYears)

        if (margin > zeroLowerBoundMargin) {
            margin = zeroLowerBoundMargin
        }

    }

    return margin
}

describe("Margin Calculator", () => {
    let wallet: Wallet, other: Wallet;
    let calculatorTest: MarginCalculatorTest;

    const fixture = async () => {

        const timeFactory = await ethers.getContractFactory("Time");

        const timeLibrary = await timeFactory.deploy();
        
        const fixedAndVariableMathFactory = await ethers.getContractFactory(
            "FixedAndVariableMath", {
                libraries: {
                    Time: timeLibrary.address
                }
            }
        );

        const fixedAndVariableMath = (await fixedAndVariableMathFactory.deploy()) as FixedAndVariableMath;

        const marginCalculator = await ethers.getContractFactory(
            "MarginCalculatorTest", {
                libraries: {
                    FixedAndVariableMath: fixedAndVariableMath.address,
                    Time: timeLibrary.address
                }
            }
        );

        return (await marginCalculator.deploy()) as MarginCalculatorTest;

    };

    let loadFixture: ReturnType<typeof createFixtureLoader>;

    before("create fixture loader", async () => {
      [wallet, other] = await (ethers as any).getSigners();

      loadFixture = createFixtureLoader([wallet, other]);
    });

    beforeEach("deploy calculator", async () => {
        calculatorTest = await loadFixture(fixture);

        // wire up the correct margin calculator parameters

    });

    describe("Margin Calculator Parameters", async () => {

        it("correctly sets the Margin Calculator Parameters", async () => {
            await calculatorTest.setMarginCalculatorParametersTest(
                RATE_ORACLE_ID, 
                APY_UPPER_MULTIPLIER, 
                APY_LOWER_MULTIPLIER,
                MIN_DELTA_LM,
                MIN_DELTA_IM,
                MAX_LEVERAGE, 
                SIGMA_SQUARED, 
                ALPHA,
                BETA, 
                XI_UPPER, 
                XI_LOWER 
            );        
            
            const marginCalculatorParameters = await calculatorTest.getMarginCalculatorParametersTest(RATE_ORACLE_ID);
            expect(marginCalculatorParameters[0]).to.eq(APY_UPPER_MULTIPLIER);
            expect(marginCalculatorParameters[1]).to.eq(APY_LOWER_MULTIPLIER);
            expect(marginCalculatorParameters[2]).to.eq(MIN_DELTA_LM);
            expect(marginCalculatorParameters[3]).to.eq(MIN_DELTA_IM);
            expect(marginCalculatorParameters[4]).to.eq(MAX_LEVERAGE);
            expect(marginCalculatorParameters[5]).to.eq(SIGMA_SQUARED);
            expect(marginCalculatorParameters[6]).to.eq(ALPHA);
            expect(marginCalculatorParameters[7]).to.eq(BETA);
            expect(marginCalculatorParameters[8]).to.eq(XI_UPPER);
            expect(marginCalculatorParameters[9]).to.eq(XI_LOWER);
            // expect(await calculatorTest.accrualFact(x)).to.eq(expected);
        });

        


    })

    // describe("getMinimumMarginRequirement", async () => {

    //     it("correctly calculates the minimum margin requirement: fixed taker, not LM", async () => {

    //         const fixedTokenBalance: BigNumber = toBn("1000")
    //         const variableTokenBalance: BigNumber = toBn("-2000")
    //         const termStartTimestamp: BigNumber = toBn("1636996083")
    //         const termEndTimestamp: BigNumber = toBn("1646996083")
    //         const isLM: boolean = false

    //         const expected = getMinimumMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //         expect(await calculatorTest.getMinimumMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     })

    //     // it("correctly calculates the minimum margin requirement: fixed taker, LM", async () => {

    //     //     const fixedTokenBalance: BigNumber = toBn("1000")
    //     //     const variableTokenBalance: BigNumber = toBn("-2000")
    //     //     const termStartTimestamp: BigNumber = toBn("1636996083")
    //     //     const termEndTimestamp: BigNumber = toBn("1646996083")
    //     //     const isLM: boolean = true

    //     //     const expected = getMinimumMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //     //     expect(await calculatorTest.getMinimumMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     // })

    //     // todo: AssertionError: Expected "3170979198376459000" to be equal 3170979198376458000

    //     // it("correctly calculates the minimum margin requirement: variable taker, not LM", async () => {

    //     //     const fixedTokenBalance: BigNumber = toBn("-1000")
    //     //     const variableTokenBalance: BigNumber = toBn("2000")
    //     //     const termStartTimestamp: BigNumber = toBn("1636996083")
    //     //     const termEndTimestamp: BigNumber = toBn("1646996083")
    //     //     const isLM: boolean = false

    //     //     const expected = getMinimumMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //     //     expect(await calculatorTest.getMinimumMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     // })

    //     // it("correctly calculates the minimum margin requirement: variable taker, LM", async () => {

    //     //     const fixedTokenBalance: BigNumber = toBn("-1000")
    //     //     const variableTokenBalance: BigNumber = toBn("2000")
    //     //     const termStartTimestamp: BigNumber = toBn("1636996083")
    //     //     const termEndTimestamp: BigNumber = toBn("1646996083")
    //     //     const isLM: boolean = false

    //     //     const expected = getMinimumMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //     //     expect(await calculatorTest.getMinimumMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     // })

    // })

    // todo: fix these small discrepancies
    // describe("worstCaseVariableFactorAtMaturity", async () => {

    //     it("correctly calculates the worst case variable factor at maturity, FT, LM", async () => {

    //         const termStartTimestamp: BigNumber = toBn("1636996083")
    //         const termEndTimestamp: BigNumber = toBn("1646996083")
    //         const timeInSeconds: BigNumber = sub(termEndTimestamp, termStartTimestamp)
    //         const isLM: boolean = true
    //         const isFT: boolean = true

    //         const expected = worstCaseVariableFactorAtMaturity(timeInSeconds, isFT, isLM)
    //         expect(await calculatorTest.worstCaseVariableFactorAtMaturityTest(timeInSeconds, isFT, isLM)).to.eq(expected)

    //     })
    // })

    // describe("#getTraderMarginRequirement", async () => {

    //     it("correctly calculates the trader margin requirement", async () => {

    //         const fixedTokenBalance: BigNumber = toBn("1000")
    //         const variableTokenBalance: BigNumber = toBn("-2000")
    //         const termStartTimestamp: BigNumber = toBn("1636996083")
    //         const termEndTimestamp: BigNumber = toBn("1646996083")
    //         const isLM: boolean = false

    //         const expected = getTraderMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //         expect(await calculatorTest.getTraderMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     })

    //     it("correctly calculates the trader margin requirement", async () => {

    //         const fixedTokenBalance: BigNumber = toBn("1000")
    //         const variableTokenBalance: BigNumber = toBn("-2000")
    //         const termStartTimestamp: BigNumber = toBn("1636996083")
    //         const termEndTimestamp: BigNumber = toBn("1646996083")
    //         const isLM: boolean = true

    //         const expected = getTraderMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //         expect(await calculatorTest.getTraderMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     })

    //     // todo: fails
    //     // it("correctly calculates the trader margin requirement", async () => {

    //     //     const fixedTokenBalance: BigNumber = toBn("-1000")
    //     //     const variableTokenBalance: BigNumber = toBn("2000")
    //     //     const termStartTimestamp: BigNumber = toBn("1636996083")
    //     //     const termEndTimestamp: BigNumber = toBn("1646996083")
    //     //     const isLM: boolean = true

    //     //     const expected = getTraderMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //     //     expect(await calculatorTest.getTraderMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     // })

    //     // todo: fails
    //     // it("correctly calculates the trader margin requirement", async () => {

    //     //     const fixedTokenBalance: BigNumber = toBn("-1000")
    //     //     const variableTokenBalance: BigNumber = toBn("2000")
    //     //     const termStartTimestamp: BigNumber = toBn("1636996083")
    //     //     const termEndTimestamp: BigNumber = toBn("1646996083")
    //     //     const isLM: boolean = false

    //     //     const expected = getTraderMarginRequirement(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)
    //     //     expect(await calculatorTest.getTraderMarginRequirementTest(fixedTokenBalance, variableTokenBalance, termStartTimestamp, termEndTimestamp, isLM)).to.eq(expected)

    //     // })

    //     // todo: introduce tests for scenarios where the minimum margin requirement is higher, lower, modelMargin is negative, positive, etc

    // })

})