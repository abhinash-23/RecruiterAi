//revesre
const str = "abhi";
const reverse = str.split("").reverse().join("");
console.log(reverse);


// Find unique values in an array
const arry = [1, 2, 2, 3, 4, 4, 5];
const result = [...new Set(arry)];
console.log(result);


//find the duplicate element
const arry1 = [1,2,3,3,2,4,5];
const result1 = arry1.filter((value,index) => arry1.indexOf(value)!==index)
console.log([...new Set(result1)]);


//sum of all number
const array2 = [10, 20, 30, 40];
const sum = array2.reduce((a,b)=> a+b,0)
console.log(sum)


// find the missing value
const array3 = [1,2,3,4,6];
const n= 6;
const sum1 = (n*(n+1)/2);
const total =array3.reduce((a,b)=> a+b,0);
const missing = sum1-total;
console.log(missing);

//odd or even
const array4 = [1,2,3,4,5,6];
const even = array4.filter((n)=>n%2==0);
const odd = array4.filter((n)=>n%2!==0);

console.log(even);
console.log(odd);


//palindriam
function palandrium(num){
    const reve= num.split("").reverse().join("");
    return num === reve
}

console.log(palandrium("mdm"))


const arr = [10, 20, 5, 40, 30];
const h= Math.max(...arr);
console.log(h)

const set = [...new Set(arr)];
set.sort((a,b)=>b-a);
console.log(set[1])





