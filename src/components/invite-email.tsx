import * as React from 'react';

interface EmailTemplateProps {
  firstName: string;
}

const InviteEmail: React.FC<Readonly<EmailTemplateProps>> = ({
  firstName,
}) => (
  <div>
    <h1>Welcome, {firstName}!</h1>
  </div>
);

export default InviteEmail