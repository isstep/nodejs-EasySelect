xports.verificationEmailTemplate = (verificationLink) => `
 <!DOCTYPE html>
 <html>
 <head>
 <meta charset="utf-8">
 <title>Подтвердите свой аккаунт</title>
 <style>
 body {
     font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
     background-color: #f4f4f4;
     color: #333;
     margin: 0;
     padding: 0;
     line-height: 1.6;
 }
 .container {
     max-width: 600px;
     margin: 20px auto;
     background-color: #fff;
     padding: 30px;
     border-radius: 8px;
     box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
     border: 1px solid #e0e0e0;
 }
 .header {
     text-align: center;
     margin-bottom: 30px;
 }
 .header img {
     max-width: 150px;
     height: auto;
 }
 .content {
     margin-bottom: 30px;
     text-align: center; 
 }
 .button-container {
     text-align: center; 
 }
 .button {
     display: inline-block;
     padding: 12px 24px;
     font-size: 16px;
     font-weight: bold;
     text-decoration: none;
     background-color: #28a745; 
     color: #fff;
     border-radius: 6px;
     transition: background-color 0.3s ease;
     border: none;
     cursor: pointer;
 }
 .button:hover {
     background-color: #218838;
 }
 .footer {
     text-align: center;
     font-size: 12px;
     color: #777;
     margin-top: 20px;
 }
 .footer a {
     color: #777;
     text-decoration: none;
 }
 </style>
 </head>
 <body>
 <div class="container">
     <div class="header">
         <img src="https://easy-select.vercel.app/123123.png" alt="Easy Select Logo">
         <h1>Easy Select</h1>
     </div>
     <div class="content">
         <p>Здравствуйте!</p>
         <p>Спасибо за регистрацию в Easy Select!</p>
         <p>Пожалуйста, нажмите на кнопку ниже, чтобы подтвердить свой аккаунт:</p>
     </div>
     <div class="button-container">
         <a href="${verificationLink}" class="button">
             Подтвердить аккаунт
         </a>
     </div>
     <div class="footer">
         <p>С уважением,  Easy Select</p>
     </div>
 </div>
 </body>
 </html>
 `;