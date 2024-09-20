'use strict';

import { DynamoDBClient, PutItemCommand, UpdateItemCommand, ScanCommand,
  DeleteItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';

import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from "@aws-sdk/client-sfn";

import { unmarshall } from '@aws-sdk/util-dynamodb';

const stepFnClient = new SFNClient();

var client = new DynamoDBClient({ region: 'us-east-1' });

  const isBookAvailable = (book, quantity) => {
    return (book.quantity - quantity) > 0
}

export const checkInventory = async({bookId, quantity}) => {
  try {
    let params = {
        "TableName": "bookTable",
        "KeyConditionExpression": "bookId = :bookId",
        "ExpressionAttributeValues": {
            ":bookId" : {"S": `${bookId}`}
        }
    };
   let book=[];
    const command = new QueryCommand(params);
    try {
      const result = await client.send(command);
    book  = result.Items.map(item => unmarshall(item)); // the map method returns
                                                          // an array of object.
    } catch (err) {
     throw err;
    }
    
    console.log(`My book: ${book}`);
    book=book[0];

    if (isBookAvailable(book, quantity)) {
        return book;
    } else {
        let bookOutOfStockError = new Error("The book is out of stock");
        bookOutOfStockError.name = "BookOutOfStock";
        throw bookOutOfStockError;
    }
} catch (e) {
    if (e.name === 'BookOutOfStock') {
        throw e;
    } else {
        let bookNotFoundError = new Error(e);
        bookNotFoundError.name = 'BookNotFound';
        throw bookNotFoundError;
    }
}
};

export const calculateTotal = async({book, quantity}) => {
  let total = book.price*quantity;
  return { total };
};
export const billCustomer = async (params) => {
  console.log(params);
  // throw 'Error in billing'
  /* Bill the customer e.g. Using Stripe token from the paramerters */
  return "Successfully Billed"
}

const deductPoints = async (userId) => {
  let params = {
      "TableName": "userTable",
      Key: { 
        "userId": {"S": `${userId}`} 
      },
      UpdateExpression: "set points = :zero",
      ExpressionAttributeValues: {
          ":zero": { "N": "0" },
      }
  };
  const command = new UpdateItemCommand(params);

  try {
    const response = await client.send(command);
    console.log(response);
  } catch (err) {
    throw err;
  } 
}


export const redeemPoints = async ({ userId, total }) => {
  let user = {};
  console.log("userId: ", userId);
  let orderTotal = total.total;
  console.log("orderTotal:", orderTotal);
  try {
      let params = {
          "TableName": "userTable",
          Key: {
              "userId": {"S": `${userId}`}
          }
      };

      const command = new GetItemCommand(params);
    try {
      let result = await client.send(command);                                             
  
    result = result.Item ? unmarshall(result.Item) : null;    //I will get result here
    console.log(result);                                    // as  a nice object
    user = result;
    } catch (err) {
     throw err;
    }
      console.log("user: ", user);
      const points = user.points;
      console.log("points: ", points);
      if (orderTotal > points) {
          await deductPoints(userId);
          orderTotal = orderTotal - points;
          return { total: orderTotal, points }
      } else {
          throw new Error('Order total is less than redeem points');
      }
  } catch (e) {
      throw new Error(e);
  }
}

export const restoreRedeemPoints = async ({ userId, total }) => {
  try {
      if (total.points) {
          let params = {
              "TableName": "userTable",
              Key: { 
                "userId": {"S": `${userId}`} 
              },
              UpdateExpression: 'set points = :points',
              ExpressionAttributeValues: {
                  ":points": {"N":  `${total.points}`}
              }
          };
          const command = new UpdateItemCommand(params);

          try {
            const response = await client.send(command);
            console.log(response);
          } catch (err) {
            throw err;
          } 
      }
  } catch (e) {
      throw new Error(e);
  }
}

const updateBookQuantity = async (bookId, orderQuantity) => {
  console.log("bookId: ", bookId);
  console.log("orderQuantity: ", orderQuantity);
  let params = {
      "TableName": "bookTable",
      Key: { 
        "bookId": { "S": `${bookId}`} 
      },
      UpdateExpression: "SET quantity = quantity - :orderQuantity",
      ExpressionAttributeValues: {
          ":orderQuantity": { "N": `${orderQuantity}`}
      }
  };
  const command = new UpdateItemCommand(params);

          try {
            const response = await client.send(command);
            console.log(response);
          } catch (err) {
            throw err;
          } 
}

export const sqsWorker = async (event) => {
  try {
      console.log(JSON.stringify(event));
      let record = event.Records[0];
      var body = JSON.parse(record.body);
      /** Find a courier and attach courier information to the order */
      let courier = "yalljoma@gmail.com";

      // update book quantity
      await updateBookQuantity(body.Input.bookId, body.Input.quantity);

     // throw "Something wrong with Courier API";

      // Attach curier information to the order
      const input = { 
        output: JSON.stringify({ courier }),
        taskToken: body.Token
      };
      const command = new SendTaskSuccessCommand(input);
      const response = await stepFnClient.send(command);

      
  } catch (e) {
      console.log("===== You got an Error =====");
      console.log(e);

      const input = { 
        taskToken: "STRING_VALUE",
        error: "NoCourierAvailable",
        cause: "No couriers are available"
      };
      const command = new SendTaskFailureCommand(input);
      const response = await stepFnClient.send(command);
  }
}

export const restoreQuantity = async ({ bookId, quantity }) => {
  let params = {
      "TableName": "bookTable",
      Key: { 
        "bookId": {"S": `${bookId}`} 
      },
      UpdateExpression: 'set quantity = quantity + :orderQuantity',
      ExpressionAttributeValues: {
          ":orderQuantity": {"N": `${quantity}`}
      }
  };
  const command = new UpdateItemCommand(params);

          try {
            const response = await client.send(command);
            if(response){
              return "Quantity restored";
            }
          } catch (err) {
            throw err;
          } 
  
}