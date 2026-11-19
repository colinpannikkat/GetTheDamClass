# **Privacy Policy for GetTheDamClass Chrome Extension**

_Last Updated: 19th November 2026_

Welcome to **GetTheDamClass**! Your privacy is important to us, and this Privacy Policy explains how we collect, use, and protect your information when you use our Chrome extension.

This policy describes the version of the extension that signs in with an emailed code. That version and its server are not released yet: until they are, what this policy says about the server describes how it is built to run.

## **Information We Collect**

The extension collects the following information:

1. **User-Provided Information**:
   - **Email Address**: Typed when you sign in. It is where your sign-in codes and class alerts are sent, and it identifies your account.
   - **Sign-in Codes**: To sign in, you type the six-digit code we email you. There is no password or PIN.

2. **Automatically Collected Information**:
   - **Watched Classes**: The term and CRN (class number) of each class you ask alerts for, and the class's title, which the server looks up from Oregon State's class search.
   - **Sign-in Tokens**: When you sign in, the server gives your browser a random token that it sends with every request, and records when each token was last used.
   - **Server Logs**: Minimal logs for troubleshooting (see "Data Storage and Security" below).

The extension does not collect browsing activity, form data, or any additional information not explicitly required for its functionality. On classes.oregonstate.edu it only reads the term and CRN of the class you have open, to know which class "Notify me" is for.

## **How We Use the Information**

The information collected is used solely for providing the core functionality of the extension:
- To email you a code when you sign in.
- To confirm by email that alerts have started, when you start them for a class.
- To notify you by email when a seat opens in a class you watch, or when it fills up again.
- To show you, in the extension, the classes you are watching, and to let you stop alerts.

We do not use your information for advertising or other unrelated purposes.

## **Data Sharing and Disclosure**

We do not sell, rent, or share your information with third parties except in the following cases:
- **Service Providers**: The server is built to run on Cloudflare (Cloudflare Workers, with its data in a Cloudflare D1 database), and sign-in codes and alert emails are sent through Cloudflare's email service. Cloudflare therefore processes your email address and the data described here on our behalf.
- **Oregon State University**: To check for open seats, the server asks Oregon State's public class search about the classes being watched, by term and CRN. Nothing about you is sent with these requests.
- **Legal Compliance**: When required to comply with applicable laws, regulations, or legal proceedings.

## **Data Storage and Security**

1. **Data Transmission**:
   - The extension is built to reach its server only over HTTPS, which encrypts everything sent between your browser and the server. The server reaches Oregon State's class search over HTTPS as well.

2. **Data Storage**:
   - The server stores your email address and when your account was created, and your alerts: for each, the term, the CRN, the class title, when you started it, and a random key used in the "stop these alerts" link in your emails.
   - Sign-in tokens are long random values, and the server stores only a hash of each, not the token itself. Sign-in codes are six digits, also stored only as hashes; a code stops working after 15 minutes, or once it has been used. For each code, the server also keeps the address it was sent to, when it was sent, and how many times someone tried to use it. This record is kept for the last code sent to each address, whether or not an account was ever made with it.
   - In your browser, the extension keeps your email address, your sign-in token, and which classes (term and CRN) you are watching, in the browser's local extension storage, unencrypted, so that it can make requests on your behalf. While you are signing in, it also remembers the address you asked a code for, and when you asked. Signing in, choosing "Use a different email" or signing out removes it straight away, and so can a failed request for a code; otherwise, once 15 minutes have passed since you asked (how long a code works), the extension removes it the next time any part of it runs (you open its popup, or a class on classes.oregonstate.edu). Signing out in the extension removes all of this from the browser. One exception: a request to start an alert that is still in progress at the moment you sign out saves your email address and that class's term and CRN when it finishes, and they stay until the next time you sign out.
   - Earlier versions of the extension kept a 4-digit PIN in your browser. The current version deletes it from your browser the first time it runs after the update.

3. **Server Logs**:
   - For each request, the server logs the method, the path (for example `/alerts/202702/33940`), and the result. These lines do not contain your email address, sign-in code, or token.
   - When something goes wrong, the server logs what happened, such as a class it could not check or an email that could not be sent. When Cloudflare's email service refuses a message, the reason it gives is logged as it is, and we cannot rule out that such a reason names the address the email was for.

4. **Automatic Removal**: A job on the server runs once a day and removes:
   - Sign-in tokens that have not been used for a year, which signs that browser out.
   - Sign-in codes whose 15 minutes are over, with the record kept for them (the address, when the code was sent, and the number of tries).
   - Alerts whose class's add deadline has passed (or, for a class without dates, whose term has closed in Oregon State's class search). You are not emailed about this; the class just leaves your list. This needs Oregon State's list of terms: on a day the job cannot read it, these alerts stay until a later day's run can, so an alert can outlast its deadline by a day or more.

   Your account and email address stay until you delete your account.

5. **Access Controls**:
   - Access to user data is restricted to authorized personnel only, under strict confidentiality.

## **User Rights**

You have the following rights concerning your data:
- **Access**: View the email address you are signed in with and the classes you are watching in the extension's popup.
- **Stop Alerts**: Stop alerts for any class from the extension (on the class page or in the popup), or with the link in any email about that class.
- **Sign Out**: Signing out removes everything the extension saved in your browser, and then asks the server to end your browser's sign-in token. If the server cannot be reached, or does not answer within a few seconds, the browser is signed out all the same, and the token stays on the server, held by no browser, until it is removed after a year without use. Your account and its alerts stay, and the alerts keep running.
- **Account Deletion**: Use "Delete my account" in the extension's popup. It deletes your account, all its alerts and every sign-in token on the server, and removes what the extension saved in your browser. The record of the last sign-in code sent to your address is not part of the account: the first daily run after that code's 15 minutes are over removes it (see "Automatic Removal"). You can also ask us to delete your account by emailing getthedamclass@gmail.com.

## **Cookies and Tracking**

This extension does not use cookies or tracking technologies.

## **Changes to This Privacy Policy**

We may update this policy from time to time to reflect changes in functionality or legal requirements. Updates are made to this file, `privacypolicy.md`, in the extension's repository on GitHub (https://github.com/colinpannikkat/GetTheDamClass), with the date at the top changed; its history there shows every change.

## **Contact Us**

If you have any questions or concerns about this Privacy Policy, please contact us at:
- **Email**: getthedamclass@gmail.com
