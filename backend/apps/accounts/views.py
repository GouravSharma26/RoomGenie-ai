from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.serializers import (
    UserLoginSerializer,
    UserProfileSerializer,
    UserRegistrationSerializer,
)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_user(request):
    """
    Register a new user account and return an authentication token.
    """
    serializer = UserRegistrationSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                'token': token.key,
                'user': UserProfileSerializer(user).data,
                'message': 'Account registered successfully.',
            },
            status=status.HTTP_201_CREATED,
        )
    return Response(
        {'detail': 'Registration validation failed.', 'errors': serializer.errors},
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def login_user(request):
    """
    Authenticate username and password and return an authentication token.
    """
    serializer = UserLoginSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.validated_data['user']
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                'token': token.key,
                'user': UserProfileSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )
    return Response(
        {'detail': 'Authentication failed.', 'errors': serializer.errors},
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_user(request):
    """
    Retrieve current authenticated user profile.
    """
    serializer = UserProfileSerializer(request.user)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def demo_auth(request):
    """
    Convenience endpoint for local development and smoke tests to obtain
    a persistent test account token without a registration wall.
    """
    user, _ = User.objects.get_or_create(
        username='demo_engineer',
        defaults={'email': 'demo@roomgenie.ai', 'first_name': 'Demo', 'last_name': 'Engineer'}
    )
    if not user.has_usable_password():
        user.set_password('DemoRoomGenie2026!')
        user.save()
    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {
            'token': token.key,
            'user': UserProfileSerializer(user).data,
            'isDemo': True,
        },
        status=status.HTTP_200_OK,
    )
