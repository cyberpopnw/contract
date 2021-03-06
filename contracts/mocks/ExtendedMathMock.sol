pragma solidity ^0.8.9;

import "../utils/ExtendedMath.sol";

contract ExtendedMathMock {
    using ExtendedMath for uint256;

    uint256 public squareRoot;
    uint256 public squaredValue;

    function sqrt(uint256 _value) external {
        squareRoot = _value.sqrt();
    }

    function pow2(uint256 _value) external {
        squaredValue = _value.pow2();
    }
}
