pragma solidity ^0.8.9;

library ExtendedMath {
    /**
     * @return The given number raised to the power of 2
     */
    function pow2(uint256 a) internal pure returns (uint256) {
        if (a == 0) {
            return 0;
        }
        uint256 c = a * a;
        require(c / a == a, "ExtendedMath: squaring overflow");
        return c;
    }

    /**
     * @return z The square root of the given number
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
